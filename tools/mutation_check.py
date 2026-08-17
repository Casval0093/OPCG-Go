#!/usr/bin/env python3
"""Prove a card's tests can actually fail.

Task 2 shipped three assertions that could not fail — a test with the right name, the right
comment, and no power to detect the defect it claimed to cover:

  * two `zone: "character"` conditions that silently excluded the Leader; both tests stayed green
    under the wrong encoding
  * a name filter that a trait filter would have satisfied equally
  * a `cardCategory` filter whose test used an Event, which the engine had already excluded
    upstream, so the filter was never consulted

All three were found by hand, by reverting the encoding and watching for a red test. That does not
scale to 220 cards. This automates it: perturb the encoding, re-run only that card's tests, and
require them to go red. A mutant that SURVIVES is a test that cannot fail.

    python3 tools/mutation_check.py --set OP16                 # every encoded OP16 card
    python3 tools/mutation_check.py --card OP16-029            # one card
    python3 tools/mutation_check.py --set OP16 --engine PATH   # against a private engine clone

Exit 1 if any mutant survives. Wire it into a batch's own verification so the batch proves its
tests rather than asserting they are fine.

The operators below are deliberately narrow. They mutate the *decision surface* — the filters,
thresholds, zones and once-per-turn flags that encode a ruling — and not the effect's shape. A
broad mutation engine would spend most of its runtime generating mutants no test should be expected
to catch, and the point here is signal about ruling conformance, not a coverage percentage.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys

ENGINE_DEFAULT = "vendor/tcg-engines/submodules/one-piece/packages/engine"
# The cards package is deliberately NOT a constant: it is resolved as a sibling of whichever engine
# --engine selects. A repo-relative constant here is what made mutants land in the wrong tree while
# the tests ran in a clone, reporting every mutant as a survivor.
TYPES = ("leaders", "characters", "events", "stages")


class Mutant:
    def __init__(self, label: str, source: str):
        self.label = label
        self.source = source


def _at(src: str, offset: int) -> str:
    """1-based line number of an offset. Two mutation sites can otherwise produce identical
    labels — Ace has `value: 8000` twice, one per clause — and a report that cannot say which
    one survived sends you looking in the wrong place."""
    return f"L{src.count(chr(10), 0, offset) + 1}"


def _mask_comments(src: str) -> str:
    """Blank out comment bodies, preserving length so offsets still index into the original.

    Without this the site finder matches code-shaped text inside comments. It really happened:
    `057-captain-buggy-s-our-savior.ts` documents its own fix as "`zone: \"field\"`, not
    `zone: \"character\"`" two lines above the real condition, so the first match was prose. The
    tool mutated a comment, nothing changed, the test passed, and it was reported as a surviving
    mutant — a false accusation against a test that was in fact load-bearing.
    """
    out = list(src)
    for m in re.finditer(r"//[^\n]*|/\*.*?\*/", src, re.S):
        for i in range(m.start(), m.end()):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)


def _filter_spans(scan: str) -> list[tuple[int, int, str]]:
    """Every `{ filter: "..." ... }` object, as (start, end, filter name).

    `end` swallows a following comma so deleting the span leaves valid TypeScript in both the
    inline (`[{ a }, { b }]`) and block layouts. Nested braces are matched properly, so a filter
    containing an object literal is removed whole rather than clipped.
    """
    spans = []
    for m in re.finditer(r'\{\s*filter:\s*"(\w+)"', scan):
        depth = 0
        i = m.start()
        while i < len(scan):
            if scan[i] == "{":
                depth += 1
            elif scan[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            continue  # unbalanced; skip rather than emit a mutant that will not compile
        end = i + 1
        j = end
        while j < len(scan) and scan[j] in " \t":
            j += 1
        if j < len(scan) and scan[j] == ",":
            end = j + 1
        spans.append((m.start(), end, m.group(1)))
    return spans


def _mutants(src: str) -> list[Mutant]:
    """Generate perturbations of a card's encoding, each targeting a real past defect.

    Sites are located in a comment-masked copy and applied to the real source, so offsets line up
    but prose is never mutated.
    """
    out: list[Mutant] = []
    scan = _mask_comments(src)

    # 1. Delete each filter object. Catches "this filter is never consulted" — the cardCategory
    #    case, and any filter a test's fixtures happen to satisfy either way.
    #
    #    Brace-matched rather than regexed to a line shape. An earlier version required the closing
    #    `}` to be followed by an optional comma and a newline, which silently skipped the inline
    #    form `filters: [{ filter: "name", value: "Bunkov" }]` — the exact shape both decisive name
    #    filters in this set use. The tool reported "all mutants killed" while never testing whether
    #    a name restriction was protected at all: the tool had the very blind spot it exists to find.
    for start, end, name in _filter_spans(scan):
        out.append(
            Mutant(f"delete filter:{name} @{_at(src, start)}", src[:start] + src[end:])
        )

    # 2. Flip comparisons. `eq` -> `gte` is the exact shape of ruling #962: "power 8000" means
    #    exactly 8000, and a `gte` encoding reads naturally but is wrong.
    for frm, to in (("gte", "lte"), ("lte", "gte"), ("eq", "gte")):
        needle = f'comparison: "{frm}"'
        for m in re.finditer(re.escape(needle), scan):
            out.append(
                Mutant(
                    f"comparison {frm}->{to} @{_at(src, m.start())}",
                    src[: m.start()] + f'comparison: "{to}"' + src[m.end() :],
                )
            )

    # 3. Perturb numeric thresholds by one power step. OPTCG power is quantised to 1000, so this
    #    is the smallest change that can alter which bodies qualify.
    for m in re.finditer(r"value:\s*(\d{3,6})\b", scan):
        v = int(m.group(1))
        if v < 1000:
            continue
        out.append(
            Mutant(
                f"value {v}->{v - 1000} @{_at(src, m.start())}",
                src[: m.start()] + f"value: {v - 1000}" + src[m.end() :],
            )
        )

    # 4. Narrow the zone. This is the C1/C2 defect verbatim: `field` includes the Leader,
    #    `character` does not, and rulings #979/#993 turn on exactly that.
    for m in re.finditer(r'zone: "field"', scan):
        out.append(
            Mutant(
                f'zone field->character @{_at(src, m.start())}',
                src[: m.start()] + 'zone: "character"' + src[m.end() :],
            )
        )

    # 5. Drop the once-per-turn guard.
    m = re.search(r"oncePerTurn: true", scan)
    if m:
        out.append(
            Mutant(
                f"drop oncePerTurn @{_at(src, m.start())}",
                src[: m.start()] + "oncePerTurn: false" + src[m.end() :],
            )
        )

    return out


def _card_files(repo: str, sets: list[str], only: str | None) -> list[tuple[str, str, str]]:
    """(card_id, source path, test path) for every card that has a hand-authored encoding."""
    found = []
    for set_id in sets:
        for kind in TYPES:
            d = os.path.join(repo, "cards", set_id, kind)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".ts") or fn.endswith(".i18n.ts") or fn == "index.ts":
                    continue
                path = os.path.join(d, fn)
                with open(path, encoding="utf-8") as fh:
                    src = fh.read()
                if "effects: {" not in src:
                    continue  # a generated shell, nothing to mutate yet
                m = re.search(r'id:\s*"([A-Z0-9-]+)"', src)
                card_id = m.group(1) if m else fn
                if only and card_id != only:
                    continue
                test = os.path.join(repo, "cards", "tests", set_id, fn.replace(".ts", ".test.ts"))
                found.append((card_id, path, test))
    return found


def _run_tests(engine: str, rel_test: str) -> bool:
    """True if the test file PASSES."""
    proc = subprocess.run(
        ["./node_modules/.bin/vp", "test", "run", rel_test],
        cwd=engine,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--set", dest="sets", action="append", default=None, help="OP15 / OP16")
    ap.add_argument("--card", default=None, help="a single card id, e.g. OP16-029")
    ap.add_argument("--engine", default=ENGINE_DEFAULT, help="engine root (use a clone when parallel)")
    ap.add_argument("--repo", default=".", help="repo root")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    engine = os.path.join(repo, args.engine) if not os.path.isabs(args.engine) else args.engine
    if not os.path.isdir(engine):
        print(f"engine not found: {engine} — run ./scripts/bootstrap.sh", file=sys.stderr)
        return 1

    sets = args.sets or ["OP15", "OP16"]
    cards = _card_files(repo, sets, args.card)
    if not cards:
        print("no hand-authored encodings found — nothing to check")
        return 0

    # Mutants must be written into the cards package of the SELECTED engine. Deriving this from
    # `repo` instead broke the documented parallel-clone workflow outright: with `--engine` pointing
    # at a private clone, mutations landed in the repo's vendor tree while the tests ran against the
    # clone's untouched encodings, so every mutant was reported as a survivor. `packages/cards` is a
    # sibling of `packages/engine`, so resolve it from there.
    vendor_cards = os.path.join(os.path.dirname(os.path.abspath(engine)), "cards", "src", "cards")
    if not os.path.isdir(vendor_cards):
        print(f"cards package not found next to the engine: {vendor_cards}", file=sys.stderr)
        return 1
    survivors: list[tuple[str, str]] = []
    total = 0

    for card_id, src_path, test_path in cards:
        if not os.path.exists(test_path):
            print(f"{card_id}: NO TEST FILE at {os.path.relpath(test_path, repo)} — cannot verify")
            survivors.append((card_id, "no test file"))
            continue

        rel = os.path.relpath(src_path, os.path.join(repo, "cards"))
        vendor_path = os.path.join(vendor_cards, rel)
        rel_test = os.path.join("tests", "cards", os.path.relpath(test_path, os.path.join(repo, "cards", "tests")))

        with open(src_path, encoding="utf-8") as fh:
            original = fh.read()
        muts = _mutants(original)

        # A baseline run guards against reporting "all mutants killed" when the suite was already
        # red for an unrelated reason.
        shutil.copyfile(src_path, vendor_path)
        if not _run_tests(engine, rel_test):
            print(f"{card_id}: BASELINE FAILS — fix the test before mutation-checking")
            survivors.append((card_id, "baseline red"))
            continue

        killed = 0
        try:
            for mut in muts:
                total += 1
                with open(vendor_path, "w", encoding="utf-8") as fh:
                    fh.write(mut.source)
                if _run_tests(engine, rel_test):
                    survivors.append((card_id, mut.label))
                else:
                    killed += 1
        finally:
            # Always put the real encoding back, in the repo copy's image.
            shutil.copyfile(src_path, vendor_path)

        mark = "ok " if killed == len(muts) else "!! "
        print(f"{mark}{card_id}: {killed}/{len(muts)} mutants killed")

    print(f"\n{total - len(survivors)}/{total} mutants killed across {len(cards)} card(s)")
    if survivors:
        print("\nSURVIVORS — these tests cannot fail on the thing they claim to cover:")
        for card_id, label in survivors:
            print(f"  {card_id}  {label}")
        print("\nEither the assertion is vacuous, or the fixtures satisfy the encoding either way.")
        return 1
    print("every mutant killed — each encoding's tests are load-bearing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
