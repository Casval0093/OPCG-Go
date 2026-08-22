#!/usr/bin/env python3
"""Field-weighted EV, Nash equilibrium, and sensitivity analysis over a matchup matrix.

Answers the project's objective function: which deck maximises expected match win rate
against the field you will actually face?

Usage:
    python3 tools/ev_analysis.py                             # default OP16 matrix
    python3 tools/ev_analysis.py --matrix data/op16-matchup-matrix.json
    python3 tools/ev_analysis.py --sensitivity Teach         # sweep one leader's share
    python3 tools/ev_analysis.py --no-nash

Requires: numpy. scipy is optional (Nash is skipped without it).

PROVENANCE (Task 12). This command reads ONE artifact and it is a legacy one:
`data/op16-matchup-matrix.json` mixes tournament shares with ladder matchups, is EN, and
was never reconciled into a single population. It is therefore permanently
`legacy_unverified` / `historical_only` / not environment-eligible, and every invocation
announces that in machine-readable form before it prints a number. Nothing here reads,
writes, or routes environment data: environment strength lives in `environment/` and is
reached through `tools/environment_data.mjs` and `tools/environment_evaluate.mjs`.
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np

DEFAULT_MATRIX = "data/op16-matchup-matrix.json"

# The single line a machine reads. Everything after it is for humans.
PROVENANCE_MARKER = "legacy-provenance"

# Labels the artifact must declare, and the values two of them are pinned to. The command
# refuses to run rather than print a weakened claim: "permanently legacy" has to be
# enforced somewhere, and the tool that reads the artifact is the only place that can.
REQUIRED_META_LABELS = ("evidence_status", "source_edition", "applicability", "environment_eligible")
# ALL FOUR are pinned, not just the two that read as dangerous. An earlier version pinned only
# `evidence_status` and `environment_eligible`, which made the "refuses to run if those labels are
# weakened" claim in CLAUDE.md, docs/environment-data.md and this artifact's own `provenance_note`
# false for the other two: `source_edition -> "SC"` and `applicability -> "current"` both printed
# the weakened value and exited 0. Relabelling this EN artifact as SC, or as currently applicable,
# is exactly the forgery the labels exist to prevent, so it is refused too.
PINNED_META_VALUES = {
    "evidence_status": "legacy_unverified",
    "source_edition": "EN",
    "applicability": "historical_only",
    "environment_eligible": False,
}


def legacy_provenance(blob, shares) -> dict:
    """The six labels every invocation announces, read from the artifact's own `_meta`.

    Read, never hardcoded: the matrix is the record. A matrix that has lost its labels
    must fail loudly instead of having them supplied by whichever tool opens it.
    """
    meta = blob.get("_meta", {})
    missing = [key for key in REQUIRED_META_LABELS if key not in meta]
    if missing:
        raise SystemExit(f"matrix is missing its provenance labels: {', '.join(missing)}")
    for key, pinned in PINNED_META_VALUES.items():
        if meta[key] is not pinned and meta[key] != pinned:
            raise SystemExit(
                f"matrix _meta.{key} is {meta[key]!r}, not {pinned!r}: this artifact is "
                "permanently legacy and this command will not print a weaker claim"
            )
    unmodelled = blob.get("unmodelled_field", {}).get("share_pct")
    if unmodelled is None:
        raise SystemExit("matrix does not declare its unmodelled remainder (unmodelled_field.share_pct)")
    return {
        "evidenceStatus": meta["evidence_status"],
        "sourceEdition": meta["source_edition"],
        "applicability": meta["applicability"],
        "coveredFieldPct": round(float(shares.sum()), 2),
        "unmodelledFieldPct": round(float(unmodelled), 2),
        "environmentEligible": bool(meta["environment_eligible"]),
    }


def load(path: str):
    with open(path, encoding="utf8") as handle:
        blob = json.load(handle)
    names = list(blob["matrix"].keys())
    size = len(names)
    matrix = np.zeros((size, size))
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            matrix[i, j] = blob["matrix"][a][b]
    shares = np.array([blob["leaders"][n]["share_pct"] for n in names], dtype=float)
    return blob, names, matrix, shares


def check_consistency(names, matrix) -> list[str]:
    """Every mirrored pair must sum to 100. Returns a list of violations."""
    problems = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            total = matrix[i, j] + matrix[j, i]
            if abs(total - 100.0) > 0.15:
                problems.append(f"{names[i]} vs {names[j]}: sums to {total:.1f}, not 100")
    return problems


def field_ev(matrix: np.ndarray, shares: np.ndarray) -> np.ndarray:
    """Expected win % against the field, mirror counted at its true share."""
    return matrix @ (shares / shares.sum())


def nash(matrix: np.ndarray):
    """Nash equilibrium mixture of the symmetric zero-sum game."""
    try:
        from scipy.optimize import linprog
    except ImportError:
        return None, None

    payoff = (matrix - 50.0) / 100.0
    size = len(matrix)
    cost = np.zeros(size + 1)
    cost[-1] = -1
    ub_a = np.hstack([-payoff.T, np.ones((size, 1))])
    eq_a = np.zeros((1, size + 1))
    eq_a[0, :size] = 1
    result = linprog(
        cost,
        A_ub=ub_a,
        b_ub=np.zeros(size),
        A_eq=eq_a,
        b_eq=[1],
        bounds=[(0, None)] * size + [(None, None)],
    )
    if not result.success:
        return None, None
    return result.x[:size], 50 + 100 * result.x[-1]


def sensitivity(names, matrix, shares, target: str, donors: list[str] | None = None):
    """Sweep one leader's share upward, drawing proportionally from the donors."""
    idx = names.index(target)
    donors = donors or [n for n in names if n != target and shares[names.index(n)] > 5]
    donor_idx = [names.index(d) for d in donors]
    donor_total = sum(shares[i] for i in donor_idx)

    print(f"\nSENSITIVITY — {target} share rises (drawn from {', '.join(donors)})")
    print(f"{'share%':>7} | " + " | ".join(f"{n[:9]:>9}" for n in names))
    rows = []
    for pct in [shares[idx], 12, 15, 18, 22, 26, 30]:
        adjusted = shares.copy()
        extra = pct - shares[idx]
        adjusted[idx] = pct
        for i in donor_idx:
            adjusted[i] = max(0.0, shares[i] - extra * shares[i] / donor_total)
        ev = field_ev(matrix, adjusted)
        best = names[int(np.argmax(ev))]
        rows.append((pct, ev, best))
        print(f"{pct:7.1f} | " + " | ".join(f"{v:9.2f}" for v in ev) + f"   -> {best}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", default=DEFAULT_MATRIX)
    parser.add_argument("--sensitivity", metavar="LEADER")
    parser.add_argument("--no-nash", action="store_true")
    args = parser.parse_args()

    blob, names, matrix, shares = load(args.matrix)

    # FIRST, before consistency, EV, sensitivity or Nash: what this evidence is and is not.
    provenance = legacy_provenance(blob, shares)
    print(f"{PROVENANCE_MARKER}: {json.dumps(provenance, sort_keys=True)}")
    print(
        "LEGACY EV -- historical EN evidence, never reconciled to one population. It cannot "
        "enter an Environment Manifest as native or as proxy evidence, and it cannot create "
        "SC/latest or EN/latest. See docs/environment-data.md."
    )

    problems = check_consistency(names, matrix)
    if problems:
        print("!! MATRIX INCONSISTENT — mirrored pairs must sum to 100:", file=sys.stderr)
        for line in problems:
            print(f"   {line}", file=sys.stderr)
    else:
        print("matrix consistency: OK (all mirrored pairs sum to 100)")

    print(
        f"covered field: {provenance['coveredFieldPct']:.2f}% of the metagame; "
        f"{provenance['unmodelledFieldPct']:.2f}% is unmodelled and NOT covered "
        "(shares are renormalized within the covered part only)"
    )
    if warn := blob.get("_meta", {}).get("bias_warning"):
        print(f"\nBIAS WARNING: {warn}\n")

    ev = field_ev(matrix, shares)
    print("FIELD-WEIGHTED EV")
    for i in np.argsort(-ev):
        print(f"  {names[i]:<12} {ev[i]:6.2f}%   (share {shares[i]:5.2f}%)")

    if not args.no_nash:
        mixture, value = nash(matrix)
        if mixture is None:
            print("\n(scipy not installed — skipping Nash)")
        else:
            weights = shares / shares.sum()
            print(f"\nNASH EQUILIBRIUM (game value {value:.2f}%)")
            for i in np.argsort(-mixture):
                if mixture[i] > 1e-6 or weights[i] > 0.01:
                    delta = 100 * mixture[i] - 100 * weights[i]
                    tag = "UNDERPLAYED" if delta > 3 else ("OVERPLAYED" if delta < -3 else "")
                    print(
                        f"  {names[i]:<12} nash {100*mixture[i]:6.2f}%  "
                        f"actual {100*weights[i]:6.2f}%  delta {delta:+6.2f}  {tag}"
                    )

    if args.sensitivity:
        sensitivity(names, matrix, shares, args.sensitivity)


if __name__ == "__main__":
    main()
