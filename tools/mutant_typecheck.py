#!/usr/bin/env python3
"""Apply every widened-operator mutant to a SCRATCH copy of the cards tree, for tsc validation.

Type validity of a single-site mutant follows from the fully-mutated tree type-checking: each
operator performs a local literal swap or a brace-balanced deletion, so validity is per-site and
unaffected by other sites being mutated at the same time. Run against a copy, never vendor/.

Patches are computed as (prefix, replaced-length, replacement) diffs against the ORIGINAL source
and applied back-to-front in one pass. Re-deriving mutants from mutated text does not work: the
player-flip operator generates the inverse flip from the flipped source and oscillates forever.

    python3 tools/mutant_typecheck.py /tmp/.../packages/cards/src/cards
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mutation_check as mc  # noqa: E402

NEW_PREFIXES = ("player ", "delete condition:", "zones drop", "amount ", "keywords drop")
NEG = re.compile(r"^value -\d")


def is_new(label: str) -> bool:
    return label.startswith(NEW_PREFIXES) or bool(NEG.match(label))


def _patch(src: str, mutant: str) -> tuple[int, int, str]:
    """(start, length of replaced region, replacement text) turning src into mutant."""
    p = 0
    limit = min(len(src), len(mutant))
    while p < limit and src[p] == mutant[p]:
        p += 1
    s = 0
    while s < limit - p and src[len(src) - 1 - s] == mutant[len(mutant) - 1 - s]:
        s += 1
    return p, len(src) - s - p, mutant[p : len(mutant) - s]


def main(cards_root: str) -> int:
    counts: dict[str, int] = {}
    n_files = 0
    for set_id in sorted(os.listdir(cards_root)):
        for kind in mc.TYPES:
            d = os.path.join(cards_root, set_id, kind)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".ts") or fn.endswith(".i18n.ts") or fn == "index.ts":
                    continue
                path = os.path.join(d, fn)
                src = open(path, encoding="utf-8").read()
                muts = [m for m in mc._mutants(src) if is_new(m.label)]
                if not muts:
                    continue
                patches = []
                for m in muts:
                    patches.append((_patch(src, m.source), m.label))
                # apply back-to-front, skipping a patch that overlaps one already applied
                # (the two negative-value mutants share their site)
                cur = src
                applied_end = len(src) + 1
                for (start, length, repl), label in sorted(
                    patches, key=lambda x: -x[0][0]
                ):
                    if start + length > applied_end:
                        continue
                    cur = cur[:start] + repl + cur[start + length :]
                    applied_end = start
                    key = label.split(" @")[0].split(" ")[0]
                    counts[key] = counts.get(key, 0) + 1
                if cur != src:
                    n_files += 1
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write(cur)
    print(f"mutated {n_files} files; applications by class: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
