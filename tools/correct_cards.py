#!/usr/bin/env python3
"""Apply OPCG-Go's verified card-data corrections to the vendored engine.

`vendor/` is gitignored and recreated by bootstrap, so a hand-edit there is lost on the next clone.
This is the card-data sibling of `tools/patch_engine.py`: that one carries *behaviour* fixes as
anchored source patches, this one carries *data* fixes as a reviewable table
(`data/card-corrections.json`) keyed by card id and field.

Every correction in that table was adjudicated against `onepiece.limitlesstcg.com` --
`tools/verify_limitless.py` is what fetches and parses it. That matters because **neither the engine
nor the npm mirror of Bandai's list is authoritative**: docs/encoding-audit.md records six printed
text divergences where the engine was right four times. So a correction is emitted only where
Limitless contradicts the engine, and the table records `from`, `to` and `why` for each one.

Three guarantees, all of which exist so an upstream refactor produces a clear failure and never a
silent no-op:

  * **Block-scoped.** A correction is applied inside the object literal whose `id:` matches, not
    file-wide. `PRB01`/`PRB02` pack many card definitions per file, so a file-wide substitution
    would corrupt a neighbouring card.
  * **Idempotent.** A field already holding `to` reports `ok` and is left alone.
  * **Drift-detecting.** A field holding neither `from` nor `to` is REFUSED, because that means
    upstream changed the value underneath us and the correction needs re-adjudicating.

    python3 tools/correct_cards.py            # apply anything outstanding
    python3 tools/correct_cards.py --check    # report only; EXIT 1 if any correction is unapplied
    python3 tools/correct_cards.py --only OP06-054   # one card

`--check` exits non-zero for an unapplied correction as well as a broken one, matching
`patch_engine.py`: an engine that merely has not been corrected yet is just as wrong to simulate
against as one whose anchor has moved.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

CARDS_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards"
TABLE = "data/card-corrections.json"

EXPORT_RE = re.compile(r"export const (\w+)\s*:\s*\w+Card\s*=\s*\{")
ID_RE = re.compile(r'(?m)^  id:\s*"([^"]+)"')

# Where a field goes when the engine omitted it entirely. Ordered by the convention the engine's own
# files follow -- cost, power, counter, trigger, traits -- so an inserted key lands where a reader
# expects it rather than at the end of the literal.
INSERT_BEFORE = {
    "power": ["counter", "trigger", "traits", "attribute", "effect", "effects"],
    "counter": ["trigger", "traits", "attribute", "effect", "effects"],
    "trigger": ["traits", "attribute", "effect", "effects"],
    "traits": ["attribute", "effect", "effects"],
}

# ST01 declares shared trait arrays (`const strawHat = ["Straw Hat Crew"];`) and writes
# `traits: strawHat`. Resolving those is what lets this tool report the value the engine really holds
# instead of reading the reference as an empty array -- the mistake that first put all 13 ST01 cards
# on the correction list when 12 of them were already right.
CONST_LIST_RE = re.compile(r"(?m)^const (\w+)\s*(?::[^=]*?)?=\s*(\[[^\]]*\])\s*;")
IDENT_RE = re.compile(r"^\w+$")


def skip_noise(source: str, index: int) -> int | None:
    """Index just past a string literal or comment starting at `index`, or None if neither.

    Comments have to be skipped, not just strings: our own OP15/OP16 encodings carry explanatory
    `//` comments containing apostrophes ("K.O.'d", "the card's own effect"), and a scanner that
    treats those as string openings runs to end of file. That silently mis-scoped 68 definitions
    before this was handled.
    """
    length = len(source)
    char = source[index]
    if char == "/" and index + 1 < length:
        if source[index + 1] == "/":
            end = source.find("\n", index)
            return length if end == -1 else end
        if source[index + 1] == "*":
            end = source.find("*/", index + 2)
            return length if end == -1 else end + 2
    if char in "\"'`":
        quote, index = char, index + 1
        while index < length:
            if source[index] == "\\":
                index += 2
                continue
            if source[index] == quote:
                return index + 1
            index += 1
        return length
    return None


def balanced_span(source: str, start: int) -> tuple[int, int]:
    """Span of the {...} literal whose opening brace is at `start`, skipping strings and comments."""
    depth, index, length = 0, start, len(source)
    while index < length:
        skipped = skip_noise(source, index)
        if skipped is not None:
            index = skipped
            continue
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return start, index + 1
        index += 1
    raise ValueError("unbalanced object literal")


def find_block(source: str, card_id: str) -> tuple[int, int]:
    """Span of the definition whose top-level `id:` is `card_id`."""
    for match in EXPORT_RE.finditer(source):
        start, end = balanced_span(source, match.end() - 1)
        found = ID_RE.search(source[start:end])
        if found and found.group(1) == card_id:
            return start, end
    raise KeyError(card_id)


def field_span(block: str, field: str) -> tuple[int, int, str] | None:
    """Span and text of a top-level `field: <value>` inside a card literal.

    The value may sit on the same line (`cost: 1,`), wrap onto the next (`effect:\\n    "..."`), or
    span several lines (a long array), so the end is found by scanning to the first comma at
    bracket/quote depth zero rather than by matching to end-of-line.
    """
    match = re.search(r"(?m)^  " + re.escape(field) + r":", block)
    if not match:
        return None
    index = match.end()
    depth, length = 0, len(block)
    while index < length:
        skipped = skip_noise(block, index)
        if skipped is not None:
            index = skipped
            continue
        char = block[index]
        if char in "[{(":
            depth += 1
        elif char in "]})":
            depth -= 1
        elif char == "," and depth == 0:
            return match.start(), index + 1, block[match.end():index].strip()
        index += 1
    return None


def render(kind: str, value) -> str:
    if kind == "number":
        return str(value)
    if kind == "traits":
        return "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in value) + "]"
    # ensure_ascii=False matters: the engine's strings carry literal U+2212 minus signs and circled
    # DON!! digits, and re-emitting them as \uXXXX escapes would be a gratuitous diff.
    return json.dumps(value, ensure_ascii=False)


def emit_field(field: str, kind: str, value, wrapped: bool) -> str:
    """A `  field: value,` line, wrapped onto a second line the way the engine's files wrap.

    The engine puts a long value on its own indented line (`effect:\\n    "..."`). Reproducing the
    shape the field already had keeps the diff to the value itself and keeps `vp check` quiet -- a
    collapsed 200-character line is a formatting change on top of a data change.
    """
    text = render(kind, value)
    inline = f"  {field}: {text},"
    if wrapped or len(inline) > 100:
        return f"  {field}:\n    {text},"
    return inline


def parse_current(kind: str, raw: str, consts: dict[str, str] | None = None):
    """The value the engine currently holds, in the same shape as the table's `from`/`to`."""
    if kind == "number":
        try:
            return int(raw)
        except ValueError:
            return None
    if kind == "traits" and IDENT_RE.match(raw):
        raw = (consts or {}).get(raw, raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # A TS array/string that json cannot read (single quotes, trailing comma) -- return the raw
        # text so the caller reports drift rather than guessing.
        return raw


def insertion_point(block: str, field: str) -> int:
    for follower in INSERT_BEFORE.get(field, []):
        span = field_span(block, follower)
        if span:
            return span[0]
    raise ValueError(f"no anchor to insert {field!r} before")


def apply_one(block: str, correction: dict, consts: dict[str, str] | None = None) -> tuple[str, str]:
    """Return (new_block, status) where status is ok | applied | DRIFT."""
    kind, field = correction["kind"], correction["field"]
    want, had = correction["to"], correction["from"]

    if kind == "fragment":
        if correction["to"] in block:
            return block, "ok"
        if correction["from"] not in block:
            return block, "DRIFT"
        return block.replace(correction["from"], correction["to"], 1), "applied"

    span = field_span(block, field)
    if span is None:
        if want is None:
            return block, "ok"
        if had is not None:
            return block, "DRIFT"
        point = insertion_point(block, field)
        return block[:point] + emit_field(field, kind, want, False) + "\n" + block[point:], "applied"

    start, end, raw = span
    current = parse_current(kind, raw, consts)
    if current == want:
        return block, "ok"
    if current != had:
        return block, "DRIFT"
    wrapped = bool(re.match(r"^  " + re.escape(field) + r":[ \t]*\n", block[start:end]))
    return block[:start] + emit_field(field, kind, want, wrapped) + block[end:], "applied"


def i18n_path(card_path: str) -> str | None:
    candidate = card_path[:-3] + ".i18n.ts"
    return candidate if os.path.isfile(candidate) else None


def index_cards(root: str) -> dict[str, str]:
    """card id -> file path, for every definition under `root`."""
    index: dict[str, str] = {}
    for dirpath, _, filenames in os.walk(root):
        for filename in sorted(filenames):
            if not filename.endswith(".ts") or filename.endswith(".i18n.ts"):
                continue
            path = os.path.join(dirpath, filename)
            with open(path, encoding="utf8", errors="ignore") as handle:
                source = handle.read()
            for match in EXPORT_RE.finditer(source):
                start, end = balanced_span(source, match.end() - 1)
                found = ID_RE.search(source[start:end])
                if found:
                    index.setdefault(found.group(1), path)
    return index


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="report status without writing; exit 1 if any correction is unapplied")
    parser.add_argument("--cards-root", default=CARDS_ROOT)
    parser.add_argument("--table", default=TABLE)
    parser.add_argument("--only", action="append", metavar="ID",
                        help="restrict to these card ids")
    parser.add_argument("--quiet", action="store_true", help="only print problems and the summary")
    args = parser.parse_args(argv)

    if not os.path.isdir(args.cards_root):
        print(f"cards not found at {args.cards_root} — run ./scripts/bootstrap.sh first",
              file=sys.stderr)
        return 1

    with open(args.table, encoding="utf8") as handle:
        table = json.load(handle)
    corrections = table["corrections"]

    # Validate the table before touching anything. Without this a hand-edited row is a KeyError deep
    # inside apply_one, halfway through a run that has already written other files.
    problems = []
    for index, correction in enumerate(corrections):
        missing = [k for k in ("id", "kind", "field", "from", "to") if k not in correction]
        if missing:
            problems.append(f"row {index} ({correction.get('id', '?')}): missing {missing}")
        elif correction["kind"] not in ("number", "traits", "string", "fragment"):
            problems.append(f"row {index} ({correction['id']}): unknown kind {correction['kind']!r}")
        elif correction["from"] == correction["to"]:
            problems.append(f"row {index} ({correction['id']}): `from` equals `to`, so it asserts "
                            f"nothing")
    if problems:
        print(f"{args.table} is malformed:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    if args.only:
        wanted = set(args.only)
        corrections = [c for c in corrections if c["id"] in wanted]

    index = index_cards(args.cards_root)
    counts = {"ok": 0, "applied": 0, "DRIFT": 0, "MISSING": 0}

    # Group by file so a file with several corrections is read and written once.
    by_path: dict[str, list[dict]] = {}
    for correction in corrections:
        path = index.get(correction["id"])
        if not path:
            print(f"  MISSING  {correction['id']}: no definition in the engine catalog")
            counts["MISSING"] += 1
            continue
        by_path.setdefault(path, []).append(correction)

    for path in sorted(by_path):
        with open(path, encoding="utf8") as handle:
            source = handle.read()
        original = source
        i18n_edits: list[tuple[str, str]] = []
        consts = dict(CONST_LIST_RE.findall(source))

        for correction in by_path[path]:
            start, end = find_block(source, correction["id"])
            block = source[start:end]
            new_block, status = apply_one(block, correction, consts)
            counts[status] += 1
            label = f"{correction['id']} {correction['field']}"
            if status == "DRIFT":
                span = field_span(block, correction["field"])
                actual = span[2] if span else "<absent>"
                print(f"  DRIFT    {label}: expected {correction['from']!r}, found {actual} — "
                      f"upstream changed this; re-adjudicate on Limitless before correcting")
                continue
            if status == "applied":
                source = source[:start] + new_block + source[end:]
                if correction["kind"] == "string" and correction["field"] == "effect":
                    i18n_edits.append((correction["from"], correction["to"]))
                if not args.quiet:
                    print(f"  applied  {label}: {correction['from']!r} -> {correction['to']!r}")
            elif not args.quiet:
                print(f"  ok       {label} (already correct)")

        if source != original and not args.check:
            with open(path, "w", encoding="utf8") as handle:
                handle.write(source)
            # The i18n sidecar duplicates `effect` for display. Left alone it would contradict the
            # card it describes, so mirror the same replacement when the old string is really there.
            sidecar = i18n_path(path)
            if sidecar and i18n_edits:
                with open(sidecar, encoding="utf8") as handle:
                    text = handle.read()
                before = text
                for old, new in i18n_edits:
                    # Compare the ENCODED literal, not the decoded string: the file holds `\n` as a
                    # two-character escape, so searching for a real newline never matches.
                    if old is None:
                        continue
                    old_token = json.dumps(old, ensure_ascii=False)
                    if old_token in text:
                        text = text.replace(old_token, json.dumps(new, ensure_ascii=False), 1)
                if text != before:
                    with open(sidecar, "w", encoding="utf8") as handle:
                        handle.write(text)
                    if not args.quiet:
                        print(f"  applied  {os.path.basename(sidecar)} (mirrored effect text)")

    pending = counts["applied"] if args.check else 0
    print(f"\ncorrections: {len(corrections)}  already-correct {counts['ok']}  "
          f"{'would-apply' if args.check else 'applied'} {counts['applied']}  "
          f"drift {counts['DRIFT']}  missing {counts['MISSING']}")
    if counts["DRIFT"]:
        print(f"{counts['DRIFT']} correction(s) refused — upstream values moved.", file=sys.stderr)
    if pending:
        print(f"{pending} correction(s) not applied — run `python3 tools/correct_cards.py`.",
              file=sys.stderr)
    return 1 if (counts["DRIFT"] or counts["MISSING"] or pending) else 0


if __name__ == "__main__":
    sys.exit(main())
