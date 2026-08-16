#!/usr/bin/env python3
"""Report card-effect encoding coverage in the vendored tcg-engines One Piece package.

Distinguishes three states:
  encoded  - card has a structured effects block the engine can execute, either
             declared on the card itself or inherited from a card it spreads
  gap      - card's printed text has an effect, but no structured encoding exists  <- the work
  vanilla  - card has no printed effect text, so having no encoding is correct

Two data-shape facts drive the classification, and getting either wrong inflates
the gap count by an order of magnitude:

  1. Alternate-art printings inherit by spread, not by copy. `OP01-016_p2` is
     declared as `{ ...op01Nami016, id: "OP01-016_p2", ... }` — it has no
     `effects:` literal of its own and does not need one. Resolving this requires
     following the spread through the import graph.

  2. The importer writes a null printed effect as `effect: "NULL"` or `effect: ""`
     rather than omitting the key. Treating a present-but-null key as "this card
     has printed text" misclassifies genuinely vanilla cards as gaps.

Usage:
    python3 tools/coverage_report.py [--cards-root PATH] [--json OUT] [--exclude-promos]
    python3 tools/coverage_report.py --show-inherited   # audit the spread resolution
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
MAX_SPREAD_DEPTH = 8

ID_RE = re.compile(r'id:\s*"([^"]+)"')
EFFECTS_RE = re.compile(r"\beffects:\s*\{")
SPREAD_RE = re.compile(r"\.\.\.([A-Za-z_$][\w$]*)")
IMPORT_RE = re.compile(r'import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"', re.S)

# A printed-effect field whose value is empty or the importer's null marker.
NULL_VALUES = {"", "NULL", "null", "-"}
TEXT_FIELD_RE = re.compile(
    r'\b(effect|trigger):\s*("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\')', re.S
)


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf8", errors="ignore") as handle:
            return handle.read()
    except OSError:
        return None


def _resolve_import(from_file: str, module: str) -> str:
    """Resolve a relative TS import specifier to a path on disk."""
    target = os.path.normpath(os.path.join(os.path.dirname(from_file), module))
    if os.path.isfile(target):
        return target
    for suffix in (".ts", ".tsx", "/index.ts"):
        if os.path.isfile(target + suffix):
            return target + suffix
    return target


def has_effects(path: str, cache: dict[str, bool], depth: int = 0) -> bool:
    """True if this card ends up with an effects block, following spread inheritance.

    A card that spreads a base card inherits that base's `effects`, so the
    absence of a local `effects:` literal does not mean the card is unencoded.
    """
    path = os.path.normpath(path)
    if path in cache:
        return cache[path]
    if depth > MAX_SPREAD_DEPTH:
        return False

    cache[path] = False  # guards import cycles
    source = _read(path)
    if source is None:
        return False

    if EFFECTS_RE.search(source):
        cache[path] = True
        return True

    spreads = set(SPREAD_RE.findall(source))
    if not spreads:
        return False

    imports: dict[str, str] = {}
    for names, module in IMPORT_RE.findall(source):
        for name in names.split(","):
            name = name.strip().split(" as ")[-1].strip()
            if name:
                imports[name] = module

    for symbol in spreads:
        module = imports.get(symbol)
        if module and has_effects(_resolve_import(path, module), cache, depth + 1):
            cache[path] = True
            return True
    return False


def has_printed_effect(i18n_path: str) -> bool:
    """True if the card's i18n carries real printed effect or trigger text.

    A present-but-null field (`effect: "NULL"`, `effect: ""`) means the card has
    no printed effect, which is not the same as the field being absent.
    """
    source = _read(i18n_path)
    if source is None:
        return False
    for _field, raw in TEXT_FIELD_RE.findall(source):
        if raw[1:-1].strip() not in NULL_VALUES:
            return True
    return False


def scan(cards_root: str) -> list[dict]:
    rows: list[dict] = []
    if not os.path.isdir(cards_root):
        sys.exit(f"cards root not found: {cards_root}\nRun scripts/bootstrap.sh first.")

    cache: dict[str, bool] = {}
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
                source = _read(path) or ""

                match = ID_RE.search(source)
                declares = bool(EFFECTS_RE.search(source))
                encoded = declares or has_effects(path, cache)
                printed = has_printed_effect(path[:-3] + ".i18n.ts")

                if encoded:
                    state = "encoded"
                elif printed:
                    state = "gap"
                else:
                    state = "vanilla"

                rows.append(
                    {
                        "set": set_code,
                        "id": match.group(1) if match else filename[:-3],
                        "type": os.path.basename(dirpath),
                        "state": state,
                        "encoding": (
                            "declared" if declares else "inherited" if encoded else "none"
                        ),
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
    parser.add_argument(
        "--show-inherited",
        action="store_true",
        help="list cards that are encoded only through a spread, to audit the resolution",
    )
    args = parser.parse_args()

    rows = scan(args.cards_root)
    if args.exclude_promos:
        rows = [r for r in rows if r["set"] not in PROMO_SETS]

    totals = collections.Counter(r["state"] for r in rows)
    inherited = [r for r in rows if r["encoding"] == "inherited"]
    print(f"card definitions : {len(rows)}")
    print(f"  encoded        : {totals['encoded']}")
    print(f"    declared     : {totals['encoded'] - len(inherited)}")
    print(f"    inherited    : {len(inherited)}  (spread from a base printing)")
    print(f"  GAPS (to do)   : {totals['gap']}")
    print(f"  vanilla        : {totals['vanilla']}")

    gaps = [r for r in rows if r["state"] == "gap"]
    if gaps:
        print("\ngaps by set:")
        for set_code, count in collections.Counter(r["set"] for r in gaps).most_common():
            print(f"  {set_code:<10} {count}")
        print("\ngap detail:")
        for row in sorted(gaps, key=lambda r: r["id"]):
            print(f"  {row['id']:<22} {row['type']:<11} {row['path']}")

    if args.show_inherited:
        print(f"\ninherited encodings ({len(inherited)}):")
        for row in sorted(inherited, key=lambda r: r["id"]):
            print(f"  {row['id']:<22} {row['path']}")

    if args.json:
        with open(args.json, "w", encoding="utf8") as handle:
            json.dump(rows, handle, indent=1)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
