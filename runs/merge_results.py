#!/usr/bin/env python3
"""Merge every `runs/<SET>.jsonl` into `runs/all-results.json`, keyed by card id.

This exists because `all-results.json` had NO producer. `runs/README.md` documented it as "the
same, merged and keyed by card id" while nothing in the repo built it, so the only way it could
ever be current was for someone to remember to rebuild it by hand -- and it was stale, by its own
README's admission, for as long as the widened sweep took to land.

It refuses to write a file that mixes instruments. Every record must carry the same operator set,
and the only evidence of that available here is the run itself, so the check is structural: a set
whose recorded mutant total disagrees with what the CURRENT tools/mutation_check.py produces for
that set's encodings is stale, and staleness is exactly what silently mixed the corpus before.
Pass --allow-stale to write anyway (and say so in whatever you quote).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import card_deps  # noqa: E402
import mutation_check as mc  # noqa: E402

VENDOR_CARDS = os.path.join(
    ROOT, "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards")


def expected_mutants(set_id: str) -> int | None:
    """Mutant count the current operator set produces for `set_id`, or None if unknowable."""
    for root in (VENDOR_CARDS, os.path.join(ROOT, "cards")):
        d = os.path.join(root, set_id)
        if not os.path.isdir(d):
            continue
        total = 0
        for _cid, path, _fn in card_deps.encoded_defs(root, set_id):
            with open(path, encoding="utf-8") as fh:
                total += len(mc._mutants(fh.read()))
        return total
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "runs", "all-results.json"))
    ap.add_argument("--allow-stale", action="store_true",
                    help="write even if a set's recorded mutant total no longer matches the tools")
    ap.add_argument("--check", action="store_true", help="report only; exit 1 if stale or missing")
    args = ap.parse_args()

    merged: dict[str, dict] = {}
    stale: list[str] = []
    for path in sorted(glob.glob(os.path.join(ROOT, "runs", "*.jsonl"))):
        set_id = os.path.basename(path)[:-6]
        rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
        want = expected_mutants(set_id)
        got = sum(r["mutants"] for r in rows)
        if want is not None and want != got:
            stale.append(f"{set_id}: recorded {got} mutants, tools now produce {want}")
        for r in rows:
            merged[r["card"]] = r | {"set": set_id}

    m = sum(r["mutants"] for r in merged.values())
    k = sum(r["killed"] for r in merged.values())
    print(f"{len(merged)} card(s), {m} mutant(s), {k} killed "
          f"({100 * k / m:.1f}%)" if m else f"{len(merged)} card(s), 0 mutants")
    for s in stale:
        print(f"  STALE {s}")
    if stale and not args.allow_stale:
        print("\nrefusing to write a mixed-instrument aggregate; re-sweep those sets, or "
              "pass --allow-stale", file=sys.stderr)
        return 1
    if args.check:
        return 1 if stale else 0
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=1, sort_keys=True)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
