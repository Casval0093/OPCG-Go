#!/usr/bin/env python3
"""Generate engine-shape TypeScript card definitions for OP15/OP16.

Reads `data/cards-OP15-en.json` and `data/cards-OP16-en.json` (produced by
`tools/import_cards.py` from the official Bandai list) and writes, for each
card, a `<NNN>-<slug>.ts` + `<NNN>-<slug>.i18n.ts` pair plus a per-type
`index.ts` into `cards/OP15/<type>/` and `cards/OP16/<type>/` in THIS repo.
`cards/` here is the single source of truth (see docs/plans/encode-op15-op16.md
Global Constraint #1); `tools/graft_cards.py` copies it into the vendored
engine.

This step is mechanical only. It emits every field the engine's `OPCard`
shape has room for -- id/printings/color/rarity/cost/power/life/counter/
trigger/traits/attribute/effect/i18n -- and NEVER an `effects:` block.
Structured effect encoding is later tasks' job, done by hand.

Shape reference: vendor/tcg-engines/submodules/one-piece/packages/cards/src/
cards/OP14EB04/characters/062-gladius.ts and its sibling .i18n.ts.

Idempotent by construction: every output field is a deterministic function of
the input JSON, so re-running with no `--force` and no hand-added `effects:`
block reproduces byte-identical output. A file that already has a hand-authored
`effects:` block is left untouched (see `--force`).

Usage:
    ./.venv/bin/python tools/gen_card_defs.py            # generate, skip encoded files
    ./.venv/bin/python tools/gen_card_defs.py --force    # regenerate everything, even
                                                          # files with an effects: block
                                                          # (destroys hand-authored effects)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA_DIR = os.path.join(REPO_ROOT, "data")
DEFAULT_CARDS_ROOT = os.path.join(REPO_ROOT, "cards")

SETS = ["OP15", "OP16"]

TYPE_DIR = {
    "leader": "leaders",
    "character": "characters",
    "event": "events",
    "stage": "stages",
}
TYPE_CLASS = {
    "leader": "LeaderCard",
    "character": "CharacterCard",
    "event": "EventCard",
    "stage": "StageCard",
}

TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
ID_RE = re.compile(r"^(OP1[56])-(\d{3})$")
EFFECTS_BLOCK_RE = re.compile(r"(?m)^\s*effects\s*:\s*\{")

# --------------------------------------------------------------------------
# Known source-data defects in data/cards-OP15-en.json / cards-OP16-en.json.
#
# Both were found by an exhaustive scan of this task's 238-card input (every
# null numeric field, every effect string not ending on a sentence/keyword
# boundary) and confirmed against onepiece.limitlesstcg.com/cards/<id>, the
# source Global Constraint #2 explicitly sanctions for text verification.
# Neither is guessed or approximated -- see task-1-report.md for the sourcing
# of each entry below.
#
# Bug 1 -- falsy-zero coercion. A card whose real printed `power` (character)
# or `cost` (event/stage) is 0 comes through as JSON `null`, not `0` -- some
# upstream step in the npm package or tools/import_cards.py treats 0 as
# "absent" (`x or None` / `x || null`). Confirmed 0 via Limitless for
# OP15-004, OP15-053, OP15-080 (power) and OP15-074 (cost); no leader has a
# null power and no character has a null cost anywhere in this dataset, so
# the fix is scoped to exactly those two (field, cardType) pairs -- see
# `_fix_falsy_zero`. This is a `tools/import_cards.py` defect, not something
# to fix by hand-patching data/*.json; flagged separately for a follow-up.
#
# Bug 2 -- false-positive split on the literal substring "[Trigger]". The
# importer cuts a card's full text at the first "[Trigger]" it finds and
# treats everything after as the card's Trigger-box text. On three cards the
# phrase "a card with a [Trigger]" is used as an in-sentence keyword
# reference (these are Blackbeard-deck cards that interact with *other*
# Trigger cards), not a section heading, so the cut lands mid-sentence: the
# tail of `effect` is lost into `trigger`, and for two of the three a real
# trigger ability further down gets glued onto that same fragment. Corrected
# text below is copied verbatim from onepiece.limitlesstcg.com/cards/<id>.
TEXT_OVERRIDES: dict[str, dict[str, str]] = {
    "OP16-080": {
        "effect": (
            "[Opponent's Turn] All of your Characters gain +1 cost.\n"
            "[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card with a "
            "[Trigger] from your hand: Change the target of that attack to this Leader "
            "or to one of your [Blackbeard Pirates] type Character cards."
        ),
        "trigger": "",
    },
    "OP16-115": {
        "effect": (
            "[Main] If your Leader has the [Blackbeard Pirates] type, add up to 1 card "
            "with a [Trigger] other than [Black Vortex] from your trash to your hand."
        ),
        "trigger": (
            "Negate the effect of up to 1 of your opponent's Leader or Character cards "
            "during this turn."
        ),
    },
    "OP16-117": {
        "effect": (
            "[Main] You may trash 1 card with a [Trigger] from your hand: Negate the "
            "effects of up to 1 of your opponent's Characters with a cost of 8 or less "
            "during this turn."
        ),
        "trigger": "Add up to 1 [Blackbeard Pirates] type card from your trash to your hand.",
    },
}

# Cards whose printed main-ability box is genuinely blank (they carry only a
# [Trigger] ability). The source represents "blank" as the literal string
# "-" instead of "". Confirmed via Limitless for all three: OP15-103 Genbo,
# OP15-106 Octoballoon, OP16-105 Gecko Moria each have real, independent
# trigger text and no main ability at all. Treated as empty effect text.
BLANK_EFFECT_MARKERS = {"-"}


class MappingError(Exception):
    """Raised when a card's JSON does not map cleanly onto the engine shape."""


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def to_kebab(text: str) -> str:
    tokens = [t.lower() for t in tokenize(text)]
    if not tokens:
        raise MappingError(f"cannot slugify empty/unslugifiable name: {text!r}")
    return "-".join(tokens)


def to_pascal(text: str) -> str:
    tokens = tokenize(text)
    return "".join(t[0].upper() + t[1:].lower() for t in tokens)


def ts_str(value: str) -> str:
    """A valid double-quoted TS/JS string literal. JSON string grammar is a
    subset of JS string grammar, so json.dumps does the escaping correctly;
    ensure_ascii=False keeps literal Unicode (e.g. the '−' minus sign
    used in DON!! costs) instead of emitting \\uXXXX escapes, matching the
    existing engine files' style."""
    return json.dumps(value, ensure_ascii=False)


def ts_str_array(values: list[str]) -> str:
    return "[" + ", ".join(ts_str(v) for v in values) + "]"


def build_symbol(set_id: str, name: str, collector_number: str) -> str:
    return set_id.lower() + to_pascal(name) + collector_number


def _fix_falsy_zero(raw: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    """Character power / event+stage cost of null is bug 1 (see module
    docstring) -- the real printed value is 0."""
    card_type = raw["cardType"]
    fixed = dict(raw)
    if card_type == "character" and fixed.get("power") is None:
        fixed["power"] = 0
        warnings.append(
            f"{raw['id']} {raw['name']}: power null -> 0 (falsy-zero import bug, "
            f"confirmed via Limitless)"
        )
    if card_type in ("event", "stage") and fixed.get("cost") is None:
        fixed["cost"] = 0
        warnings.append(
            f"{raw['id']} {raw['name']}: cost null -> 0 (falsy-zero import bug, "
            f"confirmed via Limitless)"
        )
    return fixed


def _apply_text_fixes(raw: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    fixed = dict(raw)
    cid = raw["id"]
    if cid in TEXT_OVERRIDES:
        override = TEXT_OVERRIDES[cid]
        fixed["effect"] = override["effect"]
        fixed["trigger"] = override["trigger"]
        warnings.append(
            f"{cid} {raw['name']}: effect/trigger reconstructed (false-positive "
            f"'[Trigger]' text-split bug, corrected text sourced from Limitless)"
        )
    elif (fixed.get("effect") or "").strip() in BLANK_EFFECT_MARKERS:
        fixed["effect"] = ""
    return fixed


def map_card(raw: dict[str, Any], set_id: str, warnings: list[str]) -> dict[str, Any]:
    """Normalize one JSON card record into the engine's field names/shapes.
    Returns a plain dict describing exactly what the .ts file should contain;
    does not itself touch the filesystem."""
    m = ID_RE.match(raw["id"])
    if not m or m.group(1) != set_id:
        raise MappingError(f"id {raw['id']!r} does not match expected set {set_id}")
    card_type = raw["cardType"]
    if card_type not in TYPE_DIR:
        raise MappingError(f"{raw['id']}: unsupported cardType {card_type!r}")
    if not raw.get("name"):
        raise MappingError(f"{raw['id']}: empty name")
    colors = raw.get("colors")
    if not colors:
        raise MappingError(f"{raw['id']}: no colors")

    raw = _fix_falsy_zero(raw, warnings)
    raw = _apply_text_fixes(raw, warnings)

    collector_number = m.group(2)
    card_id = raw["id"]
    name = raw["name"]
    kebab = to_kebab(name)

    attribute = (raw.get("attribute") or "").strip()
    if attribute and attribute.lower() not in {
        "strike",
        "slash",
        "ranged",
        "wisdom",
        "special",
    }:
        raise MappingError(f"{card_id}: unrecognized attribute {attribute!r}")

    effect = (raw.get("effect") or "").strip()
    trigger = (raw.get("trigger") or "").strip()
    if card_type == "leader" and trigger:
        raise MappingError(
            f"{card_id}: leader has non-empty trigger {trigger!r} -- LeaderCard has no "
            f"trigger field; this needs a TEXT_OVERRIDES entry, not silent drop"
        )

    card: dict[str, Any] = {
        "id": card_id,
        "canonicalId": card_id,
        "slug": f"{kebab}/{card_id.lower()}",
        "name": name,
        "printing": {
            "id": card_id,
            "artId": card_id,
            "setCode": set_id,
            "collectorNumber": collector_number,
            "rarity": raw["rarity"],
            "imageUrl": raw["imageUrl"],
        },
        "cardType": card_type,
        "color": list(colors),
        "rarity": raw["rarity"],
        "setId": set_id,
        "traits": list(raw.get("traits") or []),
        "attribute": attribute.lower(),
        "effect": effect,
        "trigger": trigger if card_type != "leader" else "",
        "imageUrl": raw["imageUrl"],
    }

    if card_type == "leader":
        if raw.get("power") is None:
            raise MappingError(f"{card_id}: leader missing power")
        if raw.get("life") is None:
            raise MappingError(f"{card_id}: leader missing life")
        card["power"] = raw["power"]
        card["life"] = raw["life"]
        card["counter"] = raw.get("counter")  # always None in this dataset; omitted on render
    elif card_type == "character":
        if raw.get("cost") is None:
            raise MappingError(f"{card_id}: character missing cost")
        if raw.get("power") is None:
            raise MappingError(f"{card_id}: character missing power (post-fix)")
        card["cost"] = raw["cost"]
        card["power"] = raw["power"]
        card["counter"] = raw.get("counter")
    else:  # event, stage
        if raw.get("cost") is None:
            raise MappingError(f"{card_id}: {card_type} missing cost (post-fix)")
        card["cost"] = raw["cost"]

    return card


def render_ts(card: dict[str, Any], symbol: str, filename_stub: str) -> str:
    ct = card["cardType"]
    lines: list[str] = []
    lines.append(f'import type {{ {TYPE_CLASS[ct]} }} from "@tcg/op-types";')
    lines.append(f'import {{ {symbol}I18n }} from "./{filename_stub}.i18n.ts";')
    lines.append("")
    lines.append(f"export const {symbol}: {TYPE_CLASS[ct]} = {{")
    lines.append(f'  id: {ts_str(card["id"])},')
    lines.append(f'  canonicalId: {ts_str(card["canonicalId"])},')
    lines.append(f'  slug: {ts_str(card["slug"])},')
    lines.append(f'  name: {ts_str(card["name"])},')
    lines.append("  printings: [")
    lines.append("    {")
    p = card["printing"]
    lines.append(f'      id: {ts_str(p["id"])},')
    lines.append(f'      artId: {ts_str(p["artId"])},')
    lines.append(f'      setCode: {ts_str(p["setCode"])},')
    lines.append(f'      collectorNumber: {ts_str(p["collectorNumber"])},')
    lines.append(f'      rarity: {ts_str(p["rarity"])},')
    lines.append(f'      imageUrl: {ts_str(p["imageUrl"])},')
    lines.append("    },")
    lines.append("  ],")
    lines.append(f'  cardType: {ts_str(ct)},')
    lines.append(f'  color: {ts_str_array(card["color"])},')
    lines.append(f'  rarity: {ts_str(card["rarity"])},')
    lines.append(f'  setId: {ts_str(card["setId"])},')

    if ct == "leader":
        lines.append(f'  power: {card["power"]},')
        lines.append(f'  life: {card["life"]},')
        if card.get("counter") is not None:
            lines.append(f'  counter: {card["counter"]},')
    elif ct == "character":
        lines.append(f'  cost: {card["cost"]},')
        lines.append(f'  power: {card["power"]},')
        if card.get("counter") is not None:
            lines.append(f'  counter: {card["counter"]},')
        if card["trigger"]:
            lines.append(f'  trigger: {ts_str(card["trigger"])},')
    else:  # event, stage
        lines.append(f'  cost: {card["cost"]},')
        if card["trigger"]:
            lines.append(f'  trigger: {ts_str(card["trigger"])},')

    if card["traits"]:
        lines.append(f'  traits: {ts_str_array(card["traits"])},')
    if card["attribute"]:
        lines.append(f'  attribute: {ts_str(card["attribute"])},')
    if card["effect"]:
        lines.append(f'  effect: {ts_str(card["effect"])},')
    lines.append(f"  i18n: {symbol}I18n,")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def render_i18n_ts(card: dict[str, Any], symbol: str) -> str:
    lines: list[str] = []
    lines.append('import type { OPCardI18n } from "@tcg/op-types";')
    lines.append("")
    lines.append(f"export const {symbol}I18n: OPCardI18n = {{")
    lines.append("  en: {")
    lines.append(f'    name: {ts_str(card["name"])},')
    if card["effect"]:
        lines.append(f'    effect: {ts_str(card["effect"])},')
    lines.append(f'    imageUrl: {ts_str(card["imageUrl"])},')
    lines.append("  },")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def render_type_index(entries: list[tuple[str, str]]) -> str:
    """entries: list of (symbol, filename_stub), already sorted."""
    lines = [f'export {{ {symbol} }} from "./{stub}.ts";' for symbol, stub in entries]
    lines.append("")
    return "\n".join(lines)


def write_file_if_changed(path: str, content: str) -> bool:
    if os.path.exists(path):
        with open(path, encoding="utf8") as f:
            if f.read() == content:
                return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        f.write(content)
    return True


def has_effects_block(path: str) -> bool:
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf8") as f:
        return bool(EFFECTS_BLOCK_RE.search(f.read()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--cards-root", default=DEFAULT_CARDS_ROOT)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite files even if they already contain a hand-authored "
        "`effects:` block. Destroys hand-authored effects -- use only for "
        "deliberate full regeneration.",
    )
    args = parser.parse_args()

    warnings: list[str] = []
    skipped: list[str] = []
    written = 0
    unchanged = 0
    all_symbols: dict[str, str] = {}  # symbol -> card id, for collision detection

    for set_id in SETS:
        data_path = os.path.join(args.data_dir, f"cards-{set_id}-en.json")
        with open(data_path, encoding="utf8") as f:
            raw_cards = json.load(f)

        by_type: dict[str, list[tuple[str, str]]] = {t: [] for t in TYPE_DIR}

        # Sort by collector number so output/index order is deterministic and
        # matches the printed card numbering.
        raw_cards = sorted(raw_cards, key=lambda c: c["id"])

        for raw in raw_cards:
            card = map_card(raw, set_id, warnings)
            ct = card["cardType"]
            type_dir = TYPE_DIR[ct]
            kebab = card["slug"].split("/")[0]
            collector_number = card["printing"]["collectorNumber"]
            filename_stub = f"{collector_number}-{kebab}"
            symbol = build_symbol(set_id, card["name"], collector_number)

            if symbol in all_symbols:
                raise MappingError(
                    f"symbol collision: {symbol} used by both {all_symbols[symbol]} "
                    f"and {card['id']}"
                )
            all_symbols[symbol] = card["id"]

            type_path = os.path.join(args.cards_root, set_id, type_dir)
            ts_path = os.path.join(type_path, f"{filename_stub}.ts")
            i18n_path = os.path.join(type_path, f"{filename_stub}.i18n.ts")

            by_type[ct].append((symbol, filename_stub))

            if not args.force and has_effects_block(ts_path):
                skipped.append(f"{card['id']} ({ts_path})")
                continue

            ts_content = render_ts(card, symbol, filename_stub)
            i18n_content = render_i18n_ts(card, symbol)
            if write_file_if_changed(ts_path, ts_content):
                written += 1
            else:
                unchanged += 1
            if write_file_if_changed(i18n_path, i18n_content):
                written += 1
            else:
                unchanged += 1

        for ct, type_dir in TYPE_DIR.items():
            entries = sorted(by_type[ct], key=lambda e: e[1])
            index_path = os.path.join(args.cards_root, set_id, type_dir, "index.ts")
            index_content = render_type_index(entries)
            if write_file_if_changed(index_path, index_content):
                written += 1
            else:
                unchanged += 1

    print(f"Generated {len(all_symbols)} card definitions across {', '.join(SETS)}.")
    print(f"  files written/updated: {written}, unchanged: {unchanged}")
    if skipped:
        print(f"  skipped ({len(skipped)}) -- existing effects: block, use --force to override:")
        for s in skipped:
            print(f"    - {s}")
    if warnings:
        print(f"  data fixes applied ({len(warnings)}):")
        for w in warnings:
            print(f"    - {w}")
    print(f"  symbol collisions: 0 (all {len(all_symbols)} symbols unique)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except MappingError as e:
        print(f"MAPPING ERROR: {e}", file=sys.stderr)
        sys.exit(1)
