#!/usr/bin/env python3
"""Report card-effect encoding coverage in the vendored tcg-engines One Piece package.

Distinguishes three states:
  encoded  - card has a structured `effects: {` block the engine can execute
  gap      - card's printed text has an effect, but no structured encoding exists  <- the work
  vanilla  - card has no printed effect text, so having no encoding is correct

Usage:
    python3 tools/coverage_report.py [--cards-root PATH] [--json OUT] [--exclude-promos]
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys

DEFAULT_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards"
PROMO_SETS = {"PRB01", "PRB02", "DON"}

ID_RE = re.compile(r'id:\s*"([^"]+)"')
EFFECTS_RE = re.compile(r"\beffects:\s*\{")


def scan(cards_root: str) -> list[dict]:
    rows: list[dict] = []
    if not os.path.isdir(cards_root):
        sys.exit(f"cards root not found: {cards_root}\nRun scripts/bootstrap.sh first.")

    for set_code in sorted(os.listdir(cards_root)):
        set_dir = os.path.join(cards_root, set_code)
        if not os.path.isdir(set_dir):
            continue
        for dirpath, _, filenames in os.walk(set_dir):
            for filename in filenames:
                if (
                    not filename.endswith(".ts")
                    or filename.endswith(".i18n.ts")
                    or filename == "index.ts"
                ):
                    continue
                path = os.path.join(dirpath, filename)
                with open(path, encoding="utf8", errors="ignore") as handle:
                    source = handle.read()

                match = ID_RE.search(source)
                encoded = bool(EFFECTS_RE.search(source))

                i18n_path = path[:-3] + ".i18n.ts"
                has_effect_text = False
                if os.path.exists(i18n_path):
                    with open(i18n_path, encoding="utf8", errors="ignore") as handle:
                        i18n = handle.read()
                    has_effect_text = "effect:" in i18n or "trigger:" in i18n

                if encoded:
                    state = "encoded"
                elif has_effect_text:
                    state = "gap"
                else:
                    state = "vanilla"

                rows.append(
                    {
                        "set": set_code,
                        "id": match.group(1) if match else filename[:-3],
                        "type": os.path.basename(dirpath),
                        "state": state,
                        "path": os.path.relpath(path, cards_root),
                    }
                )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-root", default=DEFAULT_ROOT)
    parser.add_argument("--json", help="write full rows to this path")
    parser.add_argument(
        "--exclude-promos",
        action="store_true",
        help=f"omit {'/'.join(sorted(PROMO_SETS))} from the summary",
    )
    args = parser.parse_args()

    rows = scan(args.cards_root)
    if args.exclude_promos:
        rows = [r for r in rows if r["set"] not in PROMO_SETS]

    totals = collections.Counter(r["state"] for r in rows)
    print(f"card definitions : {len(rows)}")
    print(f"  encoded        : {totals['encoded']}")
    print(f"  GAPS (to do)   : {totals['gap']}")
    print(f"  vanilla        : {totals['vanilla']}")

    gaps = [r for r in rows if r["state"] == "gap"]
    if gaps:
        print("\ngaps by set:")
        for set_code, count in collections.Counter(r["set"] for r in gaps).most_common():
            print(f"  {set_code:<10} {count}")

    if args.json:
        with open(args.json, "w", encoding="utf8") as handle:
            json.dump(rows, handle, indent=1)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
