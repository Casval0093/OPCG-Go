#!/usr/bin/env python3
"""Import One Piece card data for sets the vendored engine does not ship.

Why this exists
---------------
The engine covers OP01-OP14 but has nothing for OP15+, and OP15/OP16 are the sets
that decide the current SC meta. Every card-data site the project would normally
use -- optcgapi.com, onepiece.limitlesstcg.com, onepiece-cardgame.cn,
en.onepiece-cardgame.com -- is blocked by this environment's egress policy, which
allows GitHub and package registries only.

The npm registry IS reachable, and `one-piece-card-game-json` publishes the
official Bandai card list (its image_url fields point at en.onepiece-cardgame.com).
That makes it an in-policy route to the data rather than an aggregator summary,
which CLAUDE.md rules out as a source.

Trust, established rather than assumed
--------------------------------------
`--validate` cross-checks every card the dataset shares with the engine's 2,282
hand-checked definitions. Run it before trusting an import; at the pinned version
it agrees on power 100%, life 100%, cost 99.95%, counter 99.58%.

Two systematic differences are expected and are schema, not disagreement:
  - the dataset marks up text with <br> and writes traits as {Trait}, the engine
    writes [Trait]
  - the dataset concatenates the [Trigger] clause into `effects`, the engine
    keeps it in a separate `trigger` field

Usage:
    python3 tools/import_cards.py --validate            # trust check, imports nothing
    python3 tools/import_cards.py --set OP16            # -> data/cards-OP16.json
    python3 tools/import_cards.py --set OP15 --set OP16
    python3 tools/import_cards.py --list                # sets available upstream
    python3 tools/import_cards.py --set OP17 --lang jp  # once OP17 is published

Stdlib only -- no pip install, so it runs in a bare container.
"""

from __future__ import annotations

import argparse
import collections
import io
import json
import os
import re
import sys
import tarfile
import urllib.request

PACKAGE = "one-piece-card-game-json"
REGISTRY = "https://registry.npmjs.org"
ENGINE_CARDS = "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards"
CACHE = ".cache/card-source"

SET_RE = re.compile(r"^([A-Z]+\d+)-\d+$")
_NO_MATCH = re.match(r"(x)", "x")  # a match object whose group(1) never equals a set code
CARD_ID_RE = re.compile(r"^[A-Z]+\d+-\d+$")
EXPORT_RE = re.compile(r"export const (\w+)\s*:\s*\w+Card\s*=\s*\{")


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------
def fetch_dataset(version: str | None, refresh: bool = False) -> dict[str, list[dict]]:
    """Download the published tarball and return {lang: [card, ...]}.

    The tarball is cached under .cache/ so repeated runs do not re-download, and
    so an import is reproducible offline once the cache is warm.
    """
    os.makedirs(CACHE, exist_ok=True)
    meta_path = os.path.join(CACHE, "meta.json")

    with urllib.request.urlopen(f"{REGISTRY}/{PACKAGE}", timeout=60) as response:
        meta = json.load(response)
    resolved = version or meta["dist-tags"]["latest"]
    if resolved not in meta["versions"]:
        sys.exit(f"version {resolved} not published; latest is {meta['dist-tags']['latest']}")
    tarball = meta["versions"][resolved]["dist"]["tarball"]

    cached = os.path.join(CACHE, f"{resolved}.tgz")
    if refresh or not os.path.isfile(cached):
        with urllib.request.urlopen(tarball, timeout=180) as response:
            payload = response.read()
        with open(cached, "wb") as handle:
            handle.write(payload)
    with open(cached, "rb") as handle:
        payload = handle.read()

    out: dict[str, list[dict]] = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive.getmembers():
            match = re.match(r"package/(\w+)/cards\.json$", member.name)
            if not match:
                continue
            handle = archive.extractfile(member)
            if handle:
                out[match.group(1)] = json.load(handle)

    with open(meta_path, "w", encoding="utf8") as handle:
        json.dump({"package": PACKAGE, "version": resolved, "tarball": tarball}, handle, indent=1)
    print(f"source: {PACKAGE}@{resolved}")
    return out


# --------------------------------------------------------------------------
# normalisation
# --------------------------------------------------------------------------
def clean_text(text: str | None) -> str:
    """Convert the dataset's markup to the engine's conventions."""
    if not text or text.strip() in {"-", "NULL"}:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = text.replace("{", "[").replace("}", "]")   # traits: {Trait} -> [Trait]
    text = text.replace("−", "-").replace("–", "-")
    return re.sub(r"[ \t]+", " ", text).strip()


# The literal "[Trigger]" plays two different roles in card text, and only one
# of them is a section heading.
#
#   heading  -- opens the card's own Trigger box. Upstream always places it at
#               the start of the text or after a clause boundary: a full stop, a
#               closing ")" or "]", the bare "-" that stands for a blank main
#               ability, or a line break.
#   keyword  -- names *other* cards' Trigger abilities, mid-sentence, always
#               straight after a word: "trash 1 card with a [Trigger] from your
#               hand", "activates an Event or [Trigger]".
#
# Cutting at the first literal match treated a keyword reference as a heading:
# the rest of that sentence was lost out of `effect` into `trigger`, and where a
# real Trigger box followed, it was glued onto the fragment. Requiring the match
# not to follow a word separates the two roles. Checked over every record in the
# dataset: it accepts every heading (489 en / 491 jp), including the four
# non-full-stop anchors above, and rejects every keyword reference (30 en /
# 31 jp). 24 cards were being split in the wrong place, 3 of them in OP15/OP16.
#
# The first *heading* is the split point, not the last match: a Trigger box may
# itself contain a keyword reference ("[Trigger] Play up to 1 Character card
# with 5000 power or less and a [Trigger] from your hand"). No en card has two
# headings; the one jp card that does (OP01-071) has its single Trigger box
# printed twice upstream, so either choice yields the same `effect`.
TRIGGER_HEADING_RE = re.compile(r"(?<!\w)(?<!\w[ \t])\[Trigger\]\s*")


def split_trigger(effect: str) -> tuple[str, str]:
    """Separate the [Trigger] clause, which the engine stores in its own field."""
    match = TRIGGER_HEADING_RE.search(effect)
    if not match:
        return effect, ""
    return effect[: match.start()].strip(), effect[match.end() :].strip()


def numeric(value: str | None) -> int | None:
    if value is None:
        return None
    value = str(value).strip()
    return int(value) if value.isdigit() else None


def normalise(card: dict) -> dict:
    effect, trigger = split_trigger(clean_text(card.get("effects")))
    return {
        "id": card.get("card_number"),
        "name": (card.get("card_name") or "").strip(),
        "cardType": (card.get("card_type") or "").strip().lower(),
        "rarity": card.get("rarity"),
        "colors": [c.strip().lower() for c in card.get("colors") or []],
        "traits": [t.strip() for t in card.get("types") or []],
        "attribute": (card.get("attributes") or [None])[0],
        "cost": numeric(card.get("cost")),
        "power": numeric(card.get("power")),
        "counter": numeric(card.get("counter")),
        "life": numeric(card.get("life")),
        "blockIcon": numeric(card.get("block_icon")),
        "effect": effect,
        "trigger": trigger,
        "isAlternateArt": bool(card.get("is_alternate_art")),
        "setName": card.get("card_sets"),
        "imageUrl": card.get("image_url"),
    }


def dedupe(cards: list[dict]) -> list[dict]:
    """One record per card number, preferring the base printing over alternate art.

    Alternate-art printings are the same card. Keeping them would reintroduce
    exactly the variant/base text divergence documented in tools/variant_audit.py.
    """
    best: dict[str, dict] = {}
    for card in cards:
        cid = card["id"]
        if not cid or not CARD_ID_RE.match(cid):
            continue
        if cid not in best or (best[cid]["isAlternateArt"] and not card["isAlternateArt"]):
            best[cid] = card
    return [best[k] for k in sorted(best)]


# --------------------------------------------------------------------------
# validation against the engine
# --------------------------------------------------------------------------
def engine_cards() -> dict[str, dict]:
    """Parse the vendored engine's card definitions, one object literal at a time."""
    found: dict[str, dict] = {}
    if not os.path.isdir(ENGINE_CARDS):
        return found
    for dirpath, _, filenames in os.walk(ENGINE_CARDS):
        for filename in sorted(filenames):
            if not filename.endswith(".ts") or filename.endswith(".i18n.ts"):
                continue
            source = open(os.path.join(dirpath, filename), encoding="utf8", errors="ignore").read()
            for match in EXPORT_RE.finditer(source):
                start, depth = match.end() - 1, 0
                for index in range(start, len(source)):
                    if source[index] == "{":
                        depth += 1
                    elif source[index] == "}":
                        depth -= 1
                        if depth == 0:
                            block = source[start : index + 1]
                            break
                else:
                    continue

                def field(name, quoted=True):
                    pattern = (
                        rf'(?m)^\s{{2}}{name}:\s*"((?:[^"\\]|\\.)*)"'
                        if quoted
                        else rf"(?m)^\s{{2}}{name}:\s*(\d+)"
                    )
                    hit = re.search(pattern, block)
                    return hit.group(1) if hit else None

                cid = field("id")
                if cid and CARD_ID_RE.match(cid) and cid not in found:
                    found[cid] = {
                        "cost": field("cost", False),
                        "power": field("power", False),
                        "counter": field("counter", False),
                        "life": field("life", False),
                    }
    return found


def validate(cards: list[dict]) -> int:
    engine = engine_cards()
    if not engine:
        sys.exit(f"engine cards not found at {ENGINE_CARDS}\nRun scripts/bootstrap.sh first.")
    by_id = {c["id"]: c for c in cards}
    shared = sorted(set(engine) & set(by_id))
    print(f"engine {len(engine)} | dataset {len(by_id)} | overlap {len(shared)}\n")

    stats: collections.Counter = collections.Counter()
    problems = collections.defaultdict(list)
    for cid in shared:
        for field in ("cost", "power", "counter", "life"):
            engine_value, dataset_value = engine[cid][field], by_id[cid][field]
            if engine_value is None or dataset_value is None:
                continue
            stats[f"{field}:n"] += 1
            if int(engine_value) == dataset_value:
                stats[f"{field}:ok"] += 1
            else:
                problems[field].append((cid, dataset_value, int(engine_value)))

    worst = 100.0
    for field in ("cost", "power", "counter", "life"):
        total, good = stats[f"{field}:n"], stats[f"{field}:ok"]
        if total:
            pct = 100 * good / total
            worst = min(worst, pct)
            print(f"  {field:<8} {good}/{total}  ({pct:.2f}%)")
    for field, rows in problems.items():
        print(f"\n  {field} disagreements ({len(rows)}) -- one side is wrong, check the card:")
        for cid, dataset_value, engine_value in rows:
            print(f"    {cid}  dataset={dataset_value}  engine={engine_value}")

    print(f"\nverdict: {'OK' if worst >= 99.0 else 'SUSPECT'} (worst field {worst:.2f}%)")
    return 0 if worst >= 99.0 else 1


# --------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", action="append", dest="sets", metavar="CODE",
                        help="set code to import, e.g. OP16 (repeatable)")
    parser.add_argument("--lang", default="en", help="dataset language (en, jp)")
    parser.add_argument("--version", help="pin a package version instead of latest")
    parser.add_argument("--outdir", default="data")
    parser.add_argument("--list", action="store_true", help="list sets available upstream")
    parser.add_argument("--validate", action="store_true",
                        help="cross-check the dataset against the engine and exit")
    parser.add_argument("--refresh", action="store_true", help="ignore the cached tarball")
    args = parser.parse_args()

    dataset = fetch_dataset(args.version, args.refresh)
    if args.lang not in dataset:
        sys.exit(f"language {args.lang!r} not in dataset; have {sorted(dataset)}")
    cards = dedupe([normalise(c) for c in dataset[args.lang]])

    if args.list:
        counts: collections.Counter = collections.Counter()
        for card in cards:
            match = SET_RE.match(card["id"])
            if match:
                counts[match.group(1)] += 1
        print(f"\n{args.lang}: {len(cards)} cards across {len(counts)} sets")
        for code in sorted(counts):
            print(f"  {code:<8} {counts[code]}")
        return

    if args.validate:
        sys.exit(validate(cards))

    if not args.sets:
        parser.error("give --set CODE, or --list / --validate")

    os.makedirs(args.outdir, exist_ok=True)
    for code in args.sets:
        picked = [c for c in cards if (SET_RE.match(c["id"]) or _NO_MATCH).group(1) == code]
        if not picked:
            print(f"!! {code}: 0 cards upstream — not published yet?")
            continue
        encoded = sum(1 for c in picked if c["effect"])
        path = os.path.join(args.outdir, f"cards-{code}-{args.lang}.json")
        with open(path, "w", encoding="utf8") as handle:
            json.dump(picked, handle, ensure_ascii=False, indent=1)
        print(f"{code}: {len(picked)} cards ({encoded} with printed effects) -> {path}")


if __name__ == "__main__":
    main()
