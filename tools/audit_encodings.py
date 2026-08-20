#!/usr/bin/env python3
"""Audit the vendored engine's card encodings against the official Bandai list.

`coverage_report.py` answers "does this card have an encoding at all". This
answers the harder question: **is the encoding right**. The two failure modes it
is built for are the ones a green test suite cannot see.

  1. The encoding executes cleanly but was authored from the wrong printed text,
     so the DSL faithfully implements a card that does not exist. `OP06-054`
     Borsalino encodes `handCount lte 4` for a card printed "5 or less" -- and
     its test asserts the wrong threshold too, so the suite stays green.
  2. The card data underneath the encoding is wrong -- a counter value, a trait --
     which no per-card effect test looks at.

Neither source is authoritative on its own. The npm dataset is a mirror of
Bandai's own list and is right far more often than the engine, but it is not
always right: of six printed-text divergences adjudicated against Limitless,
the engine won two (`OP09-058`, `OP11-020`, `OP13-077`, `OP05-032`) and lost two
(`OP06-054`, `OP13-084`). So this tool REPORTS divergences and does not presume
a winner; verify each against `onepiece.limitlesstcg.com/cards/<ID>`.

Findings are split by whether the card is Standard-legal, because a defect in a
rotated set cannot affect a game Ping will play. Block boundaries were read off
Limitless: OP01-04 and ST01-09 are Block 1 (dead); OP05-08/ST10 Block 2;
OP09-12/ST21 Block 3; OP13+/ST29/EB04 Block 4.

Usage:
    python3 tools/audit_encodings.py                    # full audit
    python3 tools/audit_encodings.py --section traits   # one section
    python3 tools/audit_encodings.py --json out.json
Exit 1 if any Standard-legal divergence is found.
"""

from __future__ import annotations

import argparse
import collections
import difflib
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_cards as ic  # noqa: E402  (stdlib-only, same as this tool)

CARDS_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards"
ENGINE_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/engine"

# Standard == Block 2+.  OP01-OP04 and ST01-ST09 rotated out 2026-04-01.
ROTATED = {f"OP{i:02d}" for i in range(1, 5)} | {f"ST{i:02d}" for i in range(1, 10)}
OP_SETS = [f"OP{i:02d}" for i in range(1, 15)]

EXPORT_RE = re.compile(r"export const (\w+)\s*:\s*\w+Card\s*=\s*\{")
IMPORT_RE = re.compile(r'import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"', re.S)
BASE_ID_RE = re.compile(r"^[A-Z]+\d+-\d+$")
ANY_ID_RE = re.compile(r"^[A-Z]+\d*-\d+$")   # also matches the P- promos
SPREAD_RE = re.compile(r"^\s{2}\.\.\.(\w+)", re.M)
TEST_ID_RE = re.compile(r"\b([A-Z]{2,4}\d{2}-\d{3})\b")
NULLISH = {"", "-", "NULL", "null"}


def is_rotated(set_code: str) -> bool:
    return set_code in ROTATED


# --------------------------------------------------------------------------
# parsing the engine's TypeScript card definitions
# --------------------------------------------------------------------------
def _lit(quote: str) -> str:
    return quote + "((?:[^" + quote + "\\\\]|\\\\.)*)" + quote


STR_TOKEN = re.compile("|".join(_lit(q) for q in ('"', "'", "`")), re.S)


def skip_noise(source: str, index: int) -> int | None:
    """Index just past a string literal or comment at `index`, or None if neither starts there.

    Comments matter as much as strings here. Our own OP15/OP16 encodings carry explanatory `//`
    comments containing apostrophes ("K.O.'d", "the card's own effect"); a scanner that reads those
    as a string opening runs to end of file, and `balanced` then returned everything after the card
    as that card's block. That mis-scoped 68 definitions silently -- silently because `balanced`
    fell back to `source[start:]` instead of failing. Fields were still found (they precede the
    overshoot) which is why the audit's numbers held, but in a multi-card file such as PRB01/PRB02
    it would read a neighbour's fields.
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


def balanced(source: str, start: int) -> str:
    """The {...} literal beginning at `start`, skipping over string bodies and comments."""
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
                return source[start : index + 1]
        index += 1
    return source[start:]


def top_field(block: str, name: str) -> str | None:
    """Value of a field at exactly 2-space indent, i.e. the literal's top level."""
    match = re.search(rf"(?m)^\s{{2}}{re.escape(name)}:\s*", block)
    if not match:
        return None
    index, length, depth, out = match.end(), len(block), 0, []
    while index < length:
        char = block[index]
        if char in "\"'`":
            quote, piece = char, [char]
            index += 1
            while index < length:
                if block[index] == "\\":
                    piece.append(block[index : index + 2])
                    index += 2
                    continue
                piece.append(block[index])
                if block[index] == quote:
                    index += 1
                    break
                index += 1
            out.append("".join(piece))
            continue
        if char in "{[(":
            depth += 1
        elif char in "}])":
            if depth == 0:
                break
            depth -= 1
        elif char == "," and depth == 0:
            break
        out.append(char)
        index += 1
    return "".join(out).strip()


def unquote(value: str | None) -> str | None:
    """Join a TS string literal of any quote style, including `"a" + "b"`.

    Scanning left to right matters: an outer single-quoted literal containing
    double-quoted words must be consumed whole, not mined for its inner quotes.
    """
    if value is None:
        return None
    parts = [next(g for g in m.groups() if g is not None) for m in STR_TOKEN.finditer(value)]
    if not parts:
        return None
    text = "".join(parts)
    for old, new in (("\\n", "\n"), ('\\"', '"'), ("\\'", "'"), ("\\\\", "\\")):
        text = text.replace(old, new)
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)


IDENT_RE = re.compile(r"^\w+$")
CONST_LIST_RE = re.compile(r"(?m)^const (\w+)\s*(?::[^=]*?)?=\s*(\[[^\]]*\])\s*;")


def str_list(value: str | None, consts: dict[str, str] | None = None) -> list[str] | None:
    """The string elements of a TS array literal, following a `const` reference if it is one.

    ST01 does not inline its traits: it declares `const strawHat = ["Straw Hat Crew"];` and writes
    `traits: strawHat`. Without following that, all 13 ST01 cards read as `traits: []` and the audit
    reports them as a defect -- which is what an earlier run of this tool did. They are correct, and
    correctly split. `None` means genuinely absent or unresolvable; `[]` means a literal empty array.
    """
    if value is None:
        return None
    if IDENT_RE.match(value):
        resolved = (consts or {}).get(value)
        if resolved is None:
            return None          # a reference we cannot follow is unknown, not empty
        value = resolved
    return re.findall(r'"((?:[^"\\]|\\.)*)"', value, re.S)


def load_engine(root: str = CARDS_ROOT) -> dict[str, dict]:
    """Parse every card definition, block-scoped rather than file-scoped.

    PRB01/PRB02 pack many definitions into one file, so attributing an
    `effects:` block by file (as coverage_report.py does) would credit one card
    with another's encoding.
    """
    records: dict[str, dict] = {}
    name_index: dict[str, list[str]] = {}
    for dirpath, _, filenames in os.walk(root):
        for filename in sorted(filenames):
            if not filename.endswith(".ts") or filename.endswith(".i18n.ts"):
                continue
            path = os.path.normpath(os.path.join(dirpath, filename))
            source = open(path, encoding="utf8", errors="ignore").read()
            imports: dict[str, str] = {}
            for names, module in IMPORT_RE.findall(source):
                if not module.startswith("."):
                    continue
                target = os.path.normpath(os.path.join(os.path.dirname(path), module))
                for suffix in ("", ".ts", "/index.ts"):
                    if os.path.isfile(target + suffix):
                        target += suffix
                        break
                for raw in names.split(","):
                    ident = raw.split(" as ")[-1].strip()
                    if ident:
                        imports[ident] = target
            for match in EXPORT_RE.finditer(source):
                block = balanced(source, match.end() - 1)
                key = f"{path}::{match.group(1)}"
                records[key] = {"export": match.group(1), "path": path,
                                "block": block, "imports": imports,
                                "consts": dict(CONST_LIST_RE.findall(source)),
                                "id": unquote(top_field(block, "id"))}
                name_index.setdefault(match.group(1), []).append(key)

    def has_effects(record: dict, seen: tuple = ()) -> bool:
        if re.search(r"(?m)^\s{2}effects:\s*\{", record["block"]):
            return True
        for ident in SPREAD_RE.findall(record["block"]):
            if ident in seen:
                continue
            target = record["imports"].get(ident)
            keys = [k for k in name_index.get(ident, []) if target and k.startswith(target + "::")]
            keys = keys or [k for k in name_index.get(ident, [])
                            if k.startswith(record["path"] + "::")] or name_index.get(ident, [])
            if keys and has_effects(records[keys[0]], seen + (ident,)):
                return True
        return False

    cards: dict[str, dict] = {}
    for key in sorted(records):
        record = records[key]
        cid = record["id"]
        if not cid or not ANY_ID_RE.match(cid) or cid in cards:
            continue
        block = record["block"]
        cards[cid] = {
            "id": cid, "path": record["path"],
            "name": unquote(top_field(block, "name")),
            "cardType": unquote(top_field(block, "cardType")),
            "traits": str_list(top_field(block, "traits"), record["consts"]),
            "cost": top_field(block, "cost"), "power": top_field(block, "power"),
            "counter": top_field(block, "counter"), "life": top_field(block, "life"),
            "effect": unquote(top_field(block, "effect")),
            "trigger": unquote(top_field(block, "trigger")),
            "hasEffects": has_effects(record),
            "encodesTrigger": bool(re.search(r'trigger:\s*"trigger"', block)),
        }
    return cards


def scan_trait_filters(root: str = CARDS_ROOT) -> list[dict]:
    """Every `filter: "trait"` object in the encodings, with its match mode."""
    found = []
    for dirpath, _, filenames in os.walk(root):
        for filename in sorted(filenames):
            if not filename.endswith(".ts") or filename.endswith(".i18n.ts"):
                continue
            path = os.path.join(dirpath, filename)
            source = open(path, encoding="utf8", errors="ignore").read()
            for match in re.finditer(r'filter:\s*"trait"', source):
                depth, index = 0, match.start()
                block = None
                while index >= 0:
                    if source[index] == "}":
                        depth += 1
                    elif source[index] == "{":
                        if depth == 0:
                            block = balanced(source, index)
                            break
                        depth -= 1
                    index -= 1
                if block is None:
                    continue
                # Both layouts occur and the inline one is 127 of the 599:
                #   multi-line   { \n filter: "trait", \n value: "X", ... }
                #   inline       { filter: "trait", value: "X", match: "includes" }
                # so the field cannot be anchored to the start of a line. The
                # trait-filter literal is flat, so the first hit is the right one.
                value = re.search(r'\bvalue:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")', block)
                mode = re.search(r'\bmatch:\s*"(\w+)"', block)
                if value:
                    found.append({"path": os.path.relpath(path, root),
                                  "values": re.findall(r'"((?:[^"\\]|\\.)*)"', value.group(1)),
                                  "match": mode.group(1) if mode else None})
    return found


# --------------------------------------------------------------------------
# printed-text comparison
# --------------------------------------------------------------------------
GLYPH = {chr(0x2460 + i): str(i + 1) for i in range(10)}
GLYPH.update({chr(0x2780 + i): str(i + 1) for i in range(10)})
ERRATA = re.compile(r"\s*This card has been officially errata'?d\.?\s*$")
HEADING = re.compile(r"\[Trigger\]", re.I)


def clean_side(effect: str | None, trigger: str | None) -> str:
    """One comparable string from a card's effect box plus its Trigger box.

    `[Trigger]` is a section heading, not content, and the two sources disagree
    only on whether they keep it -- dropping it from both avoids scoring 165
    cards as divergent over pure markup. The importer's `"NULL"` placeholder is
    an absent field, not the printed word.
    """
    parts = []
    for value in (effect, trigger):
        value = (value or "").strip()
        if value not in NULLISH:
            parts.append(HEADING.sub(" ", value))
    return " ".join(parts).strip()


def canon(text: str) -> str:
    """Reduce printed text to comparable words.

    Everything the sources merely *spell* differently is normalised away --
    circled-digit DON!! costs, `&lt;Slash&gt;` vs `(Slash)` vs `"Slash"`,
    `[Trait]` vs `"Trait"`, the errata footnote -- so what survives is a
    difference in what the card does.
    """
    if not text:
        return ""
    out = html.unescape(ERRATA.sub("", text))
    for glyph, digit in GLYPH.items():
        out = out.replace(glyph, f" {digit} ")
    return re.sub(r"[^a-z0-9]+", " ", out.lower()).strip()


def self_duplicated(bandai: str, engine: str) -> bool:
    """Engine repeats the Trigger text in `effect` as well -- benign."""
    return bool(bandai) and bool(engine) and engine.startswith(bandai) \
        and engine[len(bandai):].strip() == bandai


# --------------------------------------------------------------------------
# sections
# --------------------------------------------------------------------------
def section_presence(dataset_ids, engine, report) -> int:
    print("=" * 74)
    print("PRESENCE -- official Bandai list vs engine catalog")
    print("=" * 74)
    rows, live_missing = {}, 0
    print(f"{'set':<7}{'bandai':>7}{'engine':>7}{'missing':>8}  status")
    for code in sorted(dataset_ids, key=lambda s: (s[:2], s)):
        have = {c for c in dataset_ids[code] if c in engine}
        missing = sorted(dataset_ids[code] - have)
        status = "promo" if code == "P" else ("rotated" if is_rotated(code) else "Standard")
        if status == "Standard":
            live_missing += len(missing)
        rows[code] = {"bandai": len(dataset_ids[code]), "engine": len(have),
                      "missing": missing, "status": status}
        print(f"{code:<7}{len(dataset_ids[code]):>7}{len(have):>7}{len(missing):>8}  {status}")
    total = sum(len(v['missing']) for v in rows.values())
    print(f"\nabsent from the engine: {total}   of which Standard-legal: {live_missing}")
    gaps = [(c, len(v["missing"])) for c, v in rows.items()
            if v["status"] == "Standard" and v["missing"]]
    print("\nStandard-legal sets with gaps:")
    for code, count in sorted(gaps, key=lambda x: -x[1]):
        print(f"   {code:<7}{count:>4}")
    report["presence"] = rows
    return live_missing


def section_numeric(dataset, engine, report) -> int:
    print("\n" + "=" * 74)
    print("NUMERIC FIELDS -- cost / power / counter / life")
    print("=" * 74)
    problems = []
    stats: collections.Counter = collections.Counter()
    for cid in sorted(set(dataset) & set(engine)):
        for field in ("cost", "power", "counter", "life"):
            raw = engine[cid][field]
            ours = int(raw) if raw is not None and str(raw).strip().isdigit() else None
            theirs = dataset[cid][field]
            if ours is None and theirs is None:
                continue
            stats["n"] += 1
            if ours == theirs:
                stats["ok"] += 1
            else:
                problems.append({"id": cid, "field": field, "bandai": theirs, "engine": ours,
                                 "rotated": is_rotated(cid.split("-")[0])})
    print(f"agree on {stats['ok']}/{stats['n']} field comparisons")
    live = [p for p in problems if not p["rotated"]]
    print(f"disagreements: {len(problems)}  (Standard-legal: {len(live)})\n")
    for p in sorted(problems, key=lambda x: (x["rotated"], x["id"])):
        tag = "rot." if p["rotated"] else "LIVE"
        print(f"  [{tag}] {p['id']:<10} {p['field']:<8} bandai={p['bandai']}  engine={p['engine']}")
    report["numeric"] = problems
    return len(live)


def section_traits(dataset, engine, report) -> int:
    print("\n" + "=" * 74)
    print("TRAITS -- storage shape and value agreement")
    print("=" * 74)
    joined, exact, wrong = 0, 0, []
    for cid in sorted(set(dataset) & set(engine)):
        theirs = [t for t in dataset[cid]["traits"] if t]
        ours = [t for t in (engine[cid]["traits"] or []) if t]
        if not theirs:
            continue
        if sorted(ours) == sorted(theirs):
            exact += 1
        elif len(ours) == 1 and len(theirs) > 1 and all(t in ours[0] for t in theirs):
            joined += 1
        else:
            wrong.append({"id": cid, "bandai": theirs, "engine": ours,
                          "rotated": is_rotated(cid.split("-")[0])})
    print(f"  correctly tokenised   {exact}")
    print(f"  space-joined string   {joined}   <- upstream sets store "
          f'["A B"] for a card with traits A and B')
    print(f"  values disagree       {len(wrong)}")
    live = [w for w in wrong if not w["rotated"]]
    print(f"\nvalue disagreements (Standard-legal: {len(live)}):")
    for w in sorted(wrong, key=lambda x: (x["rotated"], x["id"])):
        tag = "rot." if w["rotated"] else "LIVE"
        print(f"  [{tag}] {w['id']:<10} bandai={w['bandai']}  engine={w['engine']}")
    report["traits"] = {"tokenised": exact, "joined": joined, "wrong": wrong}
    return len(live)


def section_filters(dataset, engine, report) -> int:
    print("\n" + "=" * 74)
    print("TRAIT FILTERS -- what the engine matches vs what the card says")
    print("=" * 74)
    filters = scan_trait_filters()
    modes = collections.Counter(f["match"] for f in filters)
    counts = collections.Counter(v for f in filters for v in f["values"])
    print(f"trait filters: {len(filters)}   match modes: {dict(modes)}")
    print("trait matching is whole-trait equality now (engine patches 9+10): scalar values are\n"
          "brace {X} references, exact by Comprehensive Rules 2-4-3; \"type including\" filters\n"
          "carry the enumerated closure array per 2-4-3-1. So both error classes below should be\n"
          "empty -- a non-empty row is a data gap, not an encoding style:\n")
    false_pos, false_neg = collections.defaultdict(list), collections.defaultdict(list)
    for value in sorted(counts):
        for cid, card in engine.items():
            official = dataset.get(cid, {}).get("traits") or []
            if not official:
                continue
            matched = any(value == t for t in (card["traits"] or []) if t)
            if matched and value not in official:
                false_pos[value].append(cid)
            elif not matched and value in official:
                false_neg[value].append(cid)
    for label, table in (("FALSE MATCH -- engine grants the trait to cards without it", false_pos),
                         ("MISSED MATCH -- engine denies the trait to cards that have it", false_neg)):
        total = sum(len(v) for v in table.values())
        print(f"{label}: {len(table)} filter values, {total} cards")
        for value in sorted(table, key=lambda v: -len(table[v])):
            cards = table[value]
            live = sum(1 for c in cards if not is_rotated(c.split("-")[0]))
            why = sorted({t for c in cards for t in (dataset[c]["traits"] or [])
                          if value == t} or
                         {t for c in cards for t in (engine[c]["traits"] or []) if t})
            print(f"    {value!r:<24} {len(cards):>4} cards ({live} Standard) "
                  f"via {why[:3]}")
        print()
    report["filters"] = {"false_match": dict(false_pos), "missed_match": dict(false_neg)}
    return sum(1 for table in (false_pos, false_neg) for cards in table.values()
               for c in cards if not is_rotated(c.split("-")[0]))


def section_text(dataset, engine, report) -> int:
    print("=" * 74)
    print("PRINTED TEXT -- markup normalised away, so only wording remains")
    print("=" * 74)
    per_set: collections.Counter = collections.Counter()
    divergences = []
    for cid in sorted(set(dataset) & set(engine)):
        code = cid.split("-")[0]
        theirs = clean_side(dataset[cid]["effect"], dataset[cid]["trigger"])
        ours = clean_side(engine[cid]["effect"], engine[cid]["trigger"])
        per_set[f"{code}:n"] += 1
        if canon(theirs) == canon(ours):
            per_set[f"{code}:ok"] += 1
            continue
        divergences.append({"id": cid, "set": code, "bandai": theirs, "engine": ours,
                            "duplicate": self_duplicated(canon(theirs), canon(ours)),
                            "rotated": is_rotated(code),
                            "similarity": difflib.SequenceMatcher(
                                None, canon(theirs).split(), canon(ours).split()).ratio()})
    print(f"{'set':<7}{'agree':>10}{'pct':>8}")
    for code in OP_SETS:
        n, ok = per_set[f"{code}:n"], per_set[f"{code}:ok"]
        if n:
            print(f"{code:<7}{f'{ok}/{n}':>10}{100 * ok / n:>7.1f}%")
    n = sum(per_set[f"{c}:n"] for c in OP_SETS)
    ok = sum(per_set[f"{c}:ok"] for c in OP_SETS)
    print(f"{'OP01-14':<7}{f'{ok}/{n}':>10}{100 * ok / n:>7.1f}%")
    semantic = [d for d in divergences if not d["duplicate"]]
    live = [d for d in semantic if not d["rotated"]]
    print(f"\ndivergences {len(divergences)}  "
          f"(benign self-duplication {len(divergences) - len(semantic)}, "
          f"semantic {len(semantic)}, semantic+Standard {len(live)})")
    print("\nadjudicate each against onepiece.limitlesstcg.com -- the engine wins some:")
    for d in sorted(live, key=lambda x: x["similarity"]):
        print(f"\n  {d['id']}  similarity {d['similarity']:.2f}")
        print(f"    bandai: {d['bandai'][:150]}")
        print(f"    engine: {d['engine'][:150]}")
    report["text"] = divergences
    return len(live)


def section_triggers(dataset, engine, report) -> int:
    print("\n" + "=" * 74)
    print("MISSING [Trigger] ABILITIES")
    print("=" * 74)
    print("a printed Trigger box absent from BOTH the engine's text field and its")
    print("effects encoding -- the ability simply does not exist in the engine\n")
    missing = []
    for cid in sorted(set(dataset) & set(engine)):
        printed = (dataset[cid]["trigger"] or "").strip()
        if not printed:
            continue
        stored = (engine[cid]["trigger"] or "").strip()
        if stored in NULLISH and not engine[cid]["encodesTrigger"]:
            missing.append({"id": cid, "trigger": printed,
                            "rotated": is_rotated(cid.split("-")[0])})
    live = [m for m in missing if not m["rotated"]]
    print(f"found {len(missing)}  (Standard-legal: {len(live)})\n")
    for m in missing:
        tag = "rot." if m["rotated"] else "LIVE"
        print(f"  [{tag}] {m['id']:<10} {m['trigger'][:95]}")
    report["missing_triggers"] = missing
    return len(live)


def section_tests(engine, report) -> int:
    print("\n" + "=" * 74)
    print("TEST COVERAGE -- encodings no test even mentions")
    print("=" * 74)
    tested: set[str] = set()
    files = 0
    for dirpath, _, filenames in os.walk(ENGINE_ROOT):
        if "node_modules" in dirpath:
            continue
        for filename in filenames:
            if filename.endswith(".test.ts"):
                files += 1
                tested |= set(TEST_ID_RE.findall(
                    open(os.path.join(dirpath, filename), encoding="utf8",
                         errors="ignore").read()))
    # Mentioning an id is a generous proxy for testing it, so this is an upper
    # bound on coverage -- the untested list below is therefore a lower bound.
    unmentioned = sorted(c for c in engine if c not in tested and BASE_ID_RE.match(c))

    # An unmentioned card is only a FINDING if there is something to test. A vanilla -- no printed
    # effect text and no `effects:` block -- has no behaviour a test could assert, and counting it
    # inflates the number badly: an earlier version of this section reported "70 Standard-legal
    # encodings that no test even mentions" when 63 of them were vanillas and the other 11 were
    # already enumerated in data/parked-clauses.json. Split the three cases so that can't recur.
    vanilla, unencoded, untested = [], [], []
    for cid in unmentioned:
        record = engine[cid]
        printed = (record["effect"] or "").strip() not in NULLISH
        if record["hasEffects"]:
            untested.append(cid)      # a real encoding with no test in sight
        elif printed:
            unencoded.append(cid)     # printed text with no encoding -- an encoding gap, not a test gap
        else:
            vanilla.append(cid)       # nothing to assert

    def live(ids):
        return [c for c in ids if not is_rotated(c.split("-")[0])]

    print(f"test files {files}   ids referenced {len(tested)}")
    print(f"ids no test mentions: {len(unmentioned)}  (Standard-legal: {len(live(unmentioned))})")
    print(f"  vanilla, nothing to assert          {len(vanilla):>4}  "
          f"(Standard {len(live(vanilla))})")
    print(f"  printed text but NO encoding        {len(unencoded):>4}  "
          f"(Standard {len(live(unencoded))})  <- encoding gap; check parked-clauses.json")
    print(f"  HAS an encoding and no test         {len(untested):>4}  "
          f"(Standard {len(live(untested))})  <- the only real test-coverage finding")
    if unencoded:
        print(f"    {', '.join(unencoded)}")
    if untested:
        print(f"    {', '.join(untested)}")
    report["untested"] = untested
    report["unmentioned_vanilla"] = vanilla
    report["unencoded_with_text"] = unencoded
    return len(live(untested))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--section", action="append",
                        choices=["presence", "numeric", "traits", "filters",
                                 "text", "triggers", "tests"],
                        help="run only these sections (repeatable)")
    parser.add_argument("--json", help="write the full findings here")
    args = parser.parse_args()

    if not os.path.isdir(CARDS_ROOT):
        sys.exit(f"engine cards not found at {CARDS_ROOT}\nRun scripts/bootstrap.sh first.")

    raw = ic.fetch_dataset(None)
    dataset = {c["id"]: c for c in ic.dedupe([ic.normalise(c) for c in raw["en"]])}
    dataset_ids: dict[str, set] = collections.defaultdict(set)
    for record in raw["en"]:
        cid = (record.get("card_number") or "").strip()
        if ANY_ID_RE.match(cid):
            dataset_ids[cid.split("-")[0]].add(cid)
    engine = load_engine()
    print(f"engine {len(engine)} definitions | dataset {len(dataset)} deduped cards\n")

    report: dict = {"package_version": json.load(
        open(os.path.join(ic.CACHE, "meta.json"), encoding="utf8"))["version"]}
    wanted = args.section or ["presence", "numeric", "traits", "filters",
                              "text", "triggers", "tests"]
    live = 0
    if "presence" in wanted:
        live += section_presence(dataset_ids, engine, report)
    if "numeric" in wanted:
        live += section_numeric(dataset, engine, report)
    if "traits" in wanted:
        live += section_traits(dataset, engine, report)
    if "filters" in wanted:
        live += section_filters(dataset, engine, report)
    if "text" in wanted:
        live += section_text(dataset, engine, report)
    if "triggers" in wanted:
        live += section_triggers(dataset, engine, report)
    if "tests" in wanted:
        live += section_tests(engine, report)

    if args.json:
        with open(args.json, "w", encoding="utf8") as handle:
            json.dump(report, handle, indent=1, default=list)
        print(f"\nwrote {args.json}")
    print(f"\nStandard-legal findings across the sections run: {live}")
    sys.exit(1 if live else 0)


if __name__ == "__main__":
    main()
