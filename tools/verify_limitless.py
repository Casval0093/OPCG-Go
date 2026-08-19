#!/usr/bin/env python3
"""Fetch and parse card pages from Limitless -- the adjudicator this project already names.

`CLAUDE.md` and `docs/encoding-audit.md` both say the same thing: neither the vendored engine nor
the npm mirror of Bandai's list is authoritative, so **every divergence is adjudicated against
`onepiece.limitlesstcg.com/cards/<ID>`**. Until now that adjudication was done by hand, one card at
a time, which is why the audit adjudicated 17 of its divergences and left the rest as "verified in
each checked case". This tool makes it mechanical, so a correction batch can be *verified* rather
than *asserted*.

Egress is in policy: Limitless serves `User-agent: * / Disallow:` -- an empty Disallow, which
explicitly permits automated fetch. Pages are cached under `.cache/limitless/` so a re-run is
offline and reproducible, and a deliberate delay keeps the crawl polite.

The parse is structural, not positional. Limitless renders a card as:

    <p class="card-text-type">   Category • Color • N Cost|Life
    <p class="card-text-section">  N Power • Attribute • +N Counter
    <div class="card-text-section">  effect text, with "[Trigger] ..." after a <br><br>
    <div class="card-text-section"><span data-tooltip="Type">A/B/C</span>
    <div class="regulation-mark">Block N
    <div class="card-legality-badge">Standard / legal|not legal

Traits arrive slash-separated (`Supernovas/Straw Hat Crew`), which is the canonical printed list --
note that upstream's engine stores that same card space-joined and alphabetised as
`["Straw Hat Crew Supernovas"]`. That defect is documented in docs/encoding-audit.md §2.

    python3 tools/verify_limitless.py OP11-012 OP14-019      # dump what Limitless prints
    python3 tools/verify_limitless.py --json out.json OP11-012
    python3 tools/verify_limitless.py --from-audit data/encoding-audit.json --json out.json
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "https://onepiece.limitlesstcg.com/cards/"
CACHE = ".cache/limitless"
UA = "OPCG-Go/1.0 (card-text verification; contact via repo)"
DELAY = 0.7

TEXT_BLOCK_RE = re.compile(r'<div class="card-text">(.*?)<div class="card-prints"', re.S)
TYPE_LINE_RE = re.compile(r'<p class="card-text-type">(.*?)</p>', re.S)
STAT_LINE_RE = re.compile(r'<p class="card-text-section">(.*?)</p>', re.S)
SECTION_RE = re.compile(r'<div class="card-text-section"(.*?)>(.*?)</div>', re.S)
TRAIT_SPAN_RE = re.compile(r'<span data-tooltip="Type">(.*?)</span>', re.S)
TOOLTIP_RE = re.compile(r'<span data-tooltip="(\w+)">(.*?)</span>', re.S)
BLOCK_RE = re.compile(r'<div class="regulation-mark">\s*(.*?)</div>', re.S)
LEGALITY_RE = re.compile(
    r'<div class="card-legality-badge">\s*<div>(\w+)</div>\s*<div class="(\w+)">', re.S)
NAME_RE = re.compile(r'<span class="card-text-name">.*?>(.*?)</a>', re.S)
COST_RE = re.compile(r"(\d+)\s+Cost")
LIFE_RE = re.compile(r"(\d+)\s+Life")
POWER_RE = re.compile(r"(-?\d+)\s+Power")
COUNTER_RE = re.compile(r"\+?(\d+)\s+Counter")


def detag(fragment: str) -> str:
    """Visible text of an HTML fragment, with <br> as a newline and entities resolved."""
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    text = html.unescape(fragment)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def fetch(card_id: str, refresh: bool = False) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{card_id}.html")
    if os.path.isfile(path) and not refresh:
        with open(path, encoding="utf8") as handle:
            return handle.read()
    request = urllib.request.Request(BASE + card_id, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf8", "replace")
    with open(path, "w", encoding="utf8") as handle:
        handle.write(body)
    time.sleep(DELAY)
    return body


def parse(card_id: str, page: str) -> dict:
    """Structured record of what Limitless prints for one card.

    A field the card does not have is None, and that is a real distinction: only Leaders print
    Life, and a Character's Counter is genuinely optional. This is the same trap CLAUDE.md records
    for Bandai's `-` -- do not collapse "absent" into 0.
    """
    match = TEXT_BLOCK_RE.search(page)
    if not match:
        raise ValueError(f"{card_id}: no card-text block -- page shape changed or card not found")
    block = match.group(1)

    type_line = TYPE_LINE_RE.search(block)
    type_text = detag(type_line.group(1)) if type_line else ""
    tooltips = dict(
        (key, detag(value)) for key, value in TOOLTIP_RE.findall(type_line.group(1) if type_line else "")
    )

    # The stat <p> is the only bare card-text-section <p>; effect/trait sections are <div>s.
    stat_text = ""
    for candidate in STAT_LINE_RE.findall(block):
        if "Power" in candidate:
            stat_text = detag(candidate)
            break
    attribute = None
    for key, value in TOOLTIP_RE.findall(
            next((c for c in STAT_LINE_RE.findall(block) if "Power" in c), "")):
        if key == "Attribute":
            attribute = value

    traits: list[str] = []
    effect_sections: list[str] = []
    for attrs, body in SECTION_RE.findall(block):
        if "card-text-artist" in attrs:
            continue
        spans = TRAIT_SPAN_RE.findall(body)
        if spans:
            for span in spans:
                traits += [t.strip() for t in detag(span).split("/") if t.strip()]
            continue
        text = detag(body)
        # The header section wraps card-text-title/card-text-type in the BODY, not the attrs, so it
        # has to be excluded on its content -- otherwise the name, id and "Character • Red • 3 Cost"
        # line all land in `effect` and every text comparison diverges for the wrong reason.
        if "card-text-title" in body or "card-text-type" in body:
            continue
        if text and not text.startswith("Illustrated by"):
            effect_sections.append(text)

    body_text = "\n\n".join(effect_sections).strip()
    effect, trigger = split_trigger(body_text)

    legality = {name: status for name, status in LEGALITY_RE.findall(page)}
    block_mark = BLOCK_RE.search(page)
    name = NAME_RE.search(block)

    def first(pattern: re.Pattern, text: str) -> int | None:
        found = pattern.search(text)
        return int(found.group(1)) if found else None

    return {
        "id": card_id,
        "name": detag(name.group(1)) if name else None,
        "category": tooltips.get("Category"),
        "color": tooltips.get("Color"),
        "cost": first(COST_RE, type_text),
        "life": first(LIFE_RE, type_text),
        "power": first(POWER_RE, stat_text),
        "counter": first(COUNTER_RE, stat_text),
        "attribute": attribute,
        "traits": traits,
        "effect": effect,
        "trigger": trigger,
        "block": (block_mark.group(1).strip() if block_mark else None),
        "standard_legal": legality.get("Standard") == "legal",
    }


TRIGGER_HEADING_RE = re.compile(r"(?<![\w)])\[Trigger\]")


def split_trigger(text: str) -> tuple[str, str | None]:
    """Split the printed body into effect and Trigger box.

    Same trap as `import_cards.split_trigger`, and the same rule: `[Trigger]` is a *heading* only
    when it does not follow a word -- mid-sentence it is a keyword naming some other card's Trigger
    ("trash 1 card with a [Trigger] from your hand"). See CLAUDE.md.
    """
    matches = list(TRIGGER_HEADING_RE.finditer(text))
    if not matches:
        return text.strip(), None
    cut = matches[0].start()
    return text[:cut].strip(), text[matches[0].end():].strip() or None


def load(card_id: str, refresh: bool = False) -> dict:
    return parse(card_id, fetch(card_id, refresh))


def collect_audit_ids(audit_path: str) -> list[str]:
    with open(audit_path, encoding="utf8") as handle:
        audit = json.load(handle)
    ids: set[str] = set()
    ids |= {row["id"] for row in audit.get("numeric", [])}
    ids |= {row["id"] for row in audit.get("missing_triggers", [])}
    ids |= {row["id"] for row in audit.get("text", []) if not row.get("duplicate")}
    ids |= {row["id"] for row in audit.get("traits", {}).get("wrong", [])}
    return sorted(ids)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="card ids, e.g. OP11-012")
    parser.add_argument("--from-audit", metavar="PATH",
                        help="every card the audit flagged in numeric/traits/text/triggers")
    parser.add_argument("--json", metavar="PATH", help="write the parsed records here")
    parser.add_argument("--refresh", action="store_true", help="ignore the page cache")
    args = parser.parse_args()

    ids = list(args.ids)
    if args.from_audit:
        ids += [i for i in collect_audit_ids(args.from_audit) if i not in ids]
    if not ids:
        parser.error("give card ids or --from-audit")

    records, failures = {}, []
    for index, card_id in enumerate(ids, 1):
        try:
            records[card_id] = load(card_id, args.refresh)
        except (urllib.error.URLError, ValueError, OSError) as exc:
            failures.append((card_id, str(exc)))
            print(f"  FAILED {card_id}: {exc}", file=sys.stderr)
            continue
        record = records[card_id]
        if not args.json or len(ids) <= 12:
            print(f"{card_id}  {record['name']}  {record['category']}/{record['color']}  "
                  f"cost={record['cost']} life={record['life']} power={record['power']} "
                  f"counter={record['counter']}  traits={record['traits']}  "
                  f"{record['block']} standard={record['standard_legal']}")
            if record["trigger"]:
                print(f"    [Trigger] {record['trigger']}")
        elif index % 20 == 0:
            print(f"  ... {index}/{len(ids)}", file=sys.stderr)

    if args.json:
        with open(args.json, "w", encoding="utf8") as handle:
            json.dump(records, handle, indent=2, ensure_ascii=False, sort_keys=True)
        print(f"wrote {args.json}  ({len(records)} cards, {len(failures)} failed)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
