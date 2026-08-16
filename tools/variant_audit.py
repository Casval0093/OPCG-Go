#!/usr/bin/env python3
"""Audit alternate-art printings against the base card whose encoding they inherit.

Alternate-art printings in the vendored engine are declared by spread:

    export const op05NamiSp016: CharacterCard = { ...op01Nami016, id: "OP01-016_p2", ... }

The variant therefore executes the *base card's* `effects` block, while carrying
its *own* copy of the printed text in `<file>.i18n.ts`. Nothing enforces that the
two agree. Where they disagree, one of them is wrong, and because the engine runs
the base's encoding, a variant whose printed text is correct will still be
simulated using whatever the base encodes.

That makes this a correctness check on the card corpus, not a cosmetic one: a
sign-stripped power modifier or a dropped [Trigger] clause changes what the
simulator does, silently, in a card that reports as fully encoded.

Categories reported:
  identical    variant and base printed text match exactly
  absent       variant carries no text of its own (a plain reprint) - fine
  formatting   differ only in bracket/whitespace/bullet style - harmless
  sign         a +/- sign differs (power, cost, or DON!! cost) - CORRECTNESS
  keyword      one side has a bracketed keyword clause the other lacks - CORRECTNESS
  other        some other semantic difference - review individually

Usage:
    python3 tools/variant_audit.py [--cards-root PATH] [--json OUT] [--category sign]
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys

DEFAULT_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards"

SPREAD_RE = re.compile(r"\.\.\.([A-Za-z_$][\w$]*)")
IMPORT_RE = re.compile(r'import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"', re.S)
TEXT_RE = re.compile(r'\b(effect|trigger):\s*("(?:[^"\\]|\\.)*")', re.S)
KEYWORD_RE = re.compile(r"\[([A-Za-z][A-Za-z !\.']*)\]")
SIGNED_RE = re.compile(r"(-?)\s*(\d{1,5})\s*(power|cost)", re.I)
DON_RE = re.compile(r"don!!\s*(-?)\s*(\d+)", re.I)

NULL_VALUES = {"", "NULL", "null", "-"}
# Every bracketed keyword is compared, [Trigger] included. It is an ability the
# card either has or does not have, not reminder prose, so a printing that gains
# or loses one disagrees with the encoding it inherits in a way that matters.
REMINDER_KEYWORDS: set[str] = set()


# Printing-provenance notes are appended to the text on one side or the other.
# They describe the physical card, not its rules, so they are stripped before
# any comparison rather than being reported as a difference.
NOTE_RE = re.compile(
    r"(disclaimer:.*$|this card has been officially errata'?d\.?)", re.I | re.S
)


def strip_notes(text: str) -> str:
    return NOTE_RE.sub("", text).strip()


def canon(text: str) -> str:
    """Strip formatting so only semantic differences survive."""
    text = strip_notes(text).lower().replace("\\n", " ")
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    text = re.sub(r"[\[\]{}<>\"'`•·()]", "", text)
    return re.sub(r"\s+", "", text)


def read(path: str) -> str | None:
    try:
        with open(path, encoding="utf8", errors="ignore") as handle:
            return handle.read()
    except OSError:
        return None


def printed_text(i18n_path: str) -> dict[str, str]:
    source = read(i18n_path)
    if source is None:
        return {}
    out: dict[str, str] = {}
    for field, raw in TEXT_RE.findall(source):
        value = raw[1:-1].strip()
        if value not in NULL_VALUES:
            out[field] = value
    return out


def spread_base(path: str) -> tuple[str, str] | None:
    """Resolve the spread parent to (file, exported symbol name).

    The symbol matters: several sets declare every card inline in a single
    `index.ts`, so the file alone is ambiguous and reading its first `id:` would
    attribute all of ST01's printings to ST01-001.
    """
    source = read(path)
    if source is None:
        return None
    imports: dict[str, str] = {}
    for names, module in IMPORT_RE.findall(source):
        for name in names.split(","):
            name = name.strip().split(" as ")[-1].strip()
            if name:
                imports[name] = module
    for symbol in set(SPREAD_RE.findall(source)):
        module = imports.get(symbol)
        if not module:
            continue
        target = os.path.normpath(os.path.join(os.path.dirname(path), module))
        for candidate in (target, target + ".ts", os.path.join(target, "index.ts")):
            if os.path.isfile(candidate):
                return candidate, symbol
    return None


def export_block(source: str, symbol: str) -> str:
    """Slice the object literal assigned to `export const <symbol>`."""
    match = re.search(rf"export const {re.escape(symbol)}\b[^=]*=\s*\{{", source)
    if not match:
        return source
    start = match.end() - 1
    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return source[start:]


def card_text(card_path: str, symbol: str | None = None) -> dict[str, str]:
    """Printed text for a card: its own i18n file, else the inline card fields."""
    from_i18n = printed_text(card_path[:-3] + ".i18n.ts")
    if from_i18n:
        return from_i18n
    source = read(card_path)
    if source is None:
        return {}
    block = export_block(source, symbol) if symbol else source
    out: dict[str, str] = {}
    for field, raw in TEXT_RE.findall(block):
        value = raw[1:-1].strip()
        if value not in NULL_VALUES:
            out.setdefault(field, value)
    return out


def signed_values(text: str) -> set[tuple[str, str, str]]:
    text = text.replace("−", "-")
    found = {(sign or "+", num, unit.lower()) for sign, num, unit in SIGNED_RE.findall(text)}
    found |= {(sign or "+", num, "don") for sign, num in DON_RE.findall(text)}
    return found


def keywords(text: str) -> set[str]:
    return {k.strip().lower() for k in KEYWORD_RE.findall(text)} - REMINDER_KEYWORDS


def classify(variant: dict[str, str], base: dict[str, str]) -> str:
    if variant == base:
        return "identical"
    if not variant:
        return "absent"
    if {k: canon(v) for k, v in variant.items()} == {k: canon(v) for k, v in base.items()}:
        return "formatting"
    v_all = strip_notes(" ".join(variant.values()))
    b_all = strip_notes(" ".join(base.values()))
    if signed_values(v_all) != signed_values(b_all):
        return "sign"
    if keywords(v_all) != keywords(b_all):
        return "keyword"
    return "other"


def audit(cards_root: str) -> list[dict]:
    rows: list[dict] = []
    if not os.path.isdir(cards_root):
        sys.exit(f"cards root not found: {cards_root}\nRun scripts/bootstrap.sh first.")

    for dirpath, _, filenames in os.walk(cards_root):
        for filename in sorted(filenames):
            if (
                not filename.endswith(".ts")
                or filename.endswith(".i18n.ts")
                or filename == "index.ts"
            ):
                continue
            path = os.path.join(dirpath, filename)
            resolved = spread_base(path)
            if not resolved:
                continue
            base, symbol = resolved
            source = read(path) or ""
            match = re.search(r'id:\s*"([^"]+)"', source)
            base_match = re.search(
                r'id:\s*"([^"]+)"', export_block(read(base) or "", symbol)
            )
            variant_text = printed_text(path[:-3] + ".i18n.ts")
            base_text = card_text(base, symbol)
            rows.append(
                {
                    "id": match.group(1) if match else filename[:-3],
                    "base_id": base_match.group(1) if base_match else "?",
                    "category": classify(variant_text, base_text),
                    "path": os.path.relpath(path, cards_root),
                    "base_path": os.path.relpath(base, cards_root),
                    "variant_text": variant_text,
                    "base_text": base_text,
                }
            )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-root", default=DEFAULT_ROOT)
    parser.add_argument("--json", help="write full rows to this path")
    parser.add_argument("--category", help="print full text for one category only")
    args = parser.parse_args()

    rows = audit(args.cards_root)
    counts = collections.Counter(r["category"] for r in rows)
    order = ["identical", "absent", "formatting", "sign", "keyword", "other"]

    print(f"spread-inherited printings : {len(rows)}")
    for name in order:
        flag = "   <- CORRECTNESS" if name in ("sign", "keyword") and counts[name] else ""
        print(f"  {name:<12} {counts[name]:>4}{flag}")

    suspect = [r for r in rows if r["category"] in ("sign", "keyword", "other")]
    if suspect and not args.category:
        print(f"\n{len(suspect)} printings disagree with the encoding they inherit:")
        for row in sorted(suspect, key=lambda r: (r["category"], r["id"])):
            print(f"  [{row['category']:<9}] {row['id']:<22} inherits {row['base_id']}")

    if args.category:
        picked = [r for r in rows if r["category"] == args.category]
        print(f"\n--- {args.category} ({len(picked)}) ---")
        for row in sorted(picked, key=lambda r: r["id"]):
            print(f"\n{row['id']}  ({row['path']})  inherits {row['base_id']}")
            for key in sorted(set(row["variant_text"]) | set(row["base_text"])):
                print(f"   variant.{key}: {row['variant_text'].get(key, '(absent)')}")
                print(f"   base.{key}   : {row['base_text'].get(key, '(absent)')}")

    if args.json:
        with open(args.json, "w", encoding="utf8") as handle:
            json.dump(rows, handle, indent=1)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
