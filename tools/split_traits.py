#!/usr/bin/env python3
"""Regenerate the joined-trait split rows in data/card-corrections.json.

Upstream stores a multi-trait card as ONE space-joined, alphabetised string -- OP01-003 is
`traits: ["Straw Hat Crew Supernovas"]` -- on 845 cards. With exact trait matching (the
targeting.ts / conditions.ts collapses in tools/patch_engine.py) that storage shape matches
nothing, so every joined value is split into the official trait list.

The split is SHAPE-ONLY: a card's `to` list must contain exactly the traits the joined string
carried. That is checkable without adjudication -- tokenise the joined string against the official
trait vocabulary (longest match first, so "Former Whitebeard Pirates" wins over "Whitebeard
Pirates") and require the multiset to equal the Bandai npm mirror's `types` list for the same card
(the mirror's order differs from the engine's alphabetical join, which is why the check is on the
sorted lists). A card that fails the check needs hand adjudication against Limitless instead --
five historic cases (OP01-008, OP01-019, OP01-034, OP11-031, EB01-036, plus P-029) carry hand rows
in the same table, and this tool validates those rows' `from` values instead of overwriting them.

Rows this tool owns carry `"generated": "tools/split_traits.py"`; every other row in the table is
left alone. The tool is safe to run on a tree where the corrections are already applied: a card
whose engine traits now sort-equal its row's `to` keeps its row (a fresh `vendor/` clone is joined
again, so the row is still wanted). Anything else is drift and fails loudly.

    python3 tools/split_traits.py            # rewrite the generated block of the table
    python3 tools/split_traits.py --check    # exit 1 if the table would change

Offline by design: the dataset is read from the cached npm tarball under .cache/card-source/
(warmed by tools/import_cards.py); nothing here touches the network.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_encodings as ae  # noqa: E402  (stdlib-only, same as the other tools)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLE = os.path.join(REPO_ROOT, "data/card-corrections.json")
CACHE = os.path.join(REPO_ROOT, ".cache/card-source")
MARKER = "tools/split_traits.py"
VERIFIED = "2026-08-21"

WHY = ("space-joined trait storage split into the official list (cross-checked against the Bandai "
       "npm mirror); shape-only — the same values, exact-matchable")


def load_dataset() -> dict[str, list[str]]:
    """card id -> official trait list, from the cached npm mirror of Bandai's list."""
    with open(os.path.join(CACHE, "meta.json"), encoding="utf8") as handle:
        version = json.load(handle)["version"]
    tarball = os.path.join(CACHE, f"{version}.tgz")
    if not os.path.isfile(tarball):
        sys.exit(f"dataset cache missing at {tarball} — run `python3 tools/import_cards.py` once")
    with tarfile.open(tarball, "r:gz") as archive:
        for member in archive.getmembers():
            match = re.match(r"package/(\w+)/cards\.json$", member.name)
            if match and match.group(1) == "en":
                data = json.load(archive.extractfile(member))
                break
        else:
            sys.exit(f"{tarball} holds no en/cards.json — re-fetch with import_cards.py")
    dataset: dict[str, list[str]] = {}
    for card in data:  # variant rows repeat the base traits; first row wins
        dataset.setdefault(card["card_number"],
                           [t for t in (card.get("types") or []) if t])
    return dataset


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if the table would change, without writing")
    args = parser.parse_args(argv)

    dataset = load_dataset()
    engine = ae.load_engine()

    # The official trait vocabulary: every trait the mirror lists, plus single-token engine traits
    # (a token containing a space is exactly the defect being fixed, so it cannot join the vocab).
    vocab = {t for traits in dataset.values() for t in traits}
    for record in engine.values():
        vocab.update(t for t in (record["traits"] or []) if t and " " not in t)
    by_length = sorted(vocab, key=len, reverse=True)

    def tokenize(joined: str) -> list[str] | None:
        """Greedy longest-match split of a joined string, or None if it does not parse."""
        out, index = [], 0
        while index < len(joined):
            if joined[index] == " ":
                index += 1
                continue
            for trait in by_length:
                if joined.startswith(trait, index) and (
                        index + len(trait) == len(joined) or joined[index + len(trait)] == " "):
                    out.append(trait)
                    index += len(trait)
                    break
            else:
                return None
        return out

    with open(TABLE, encoding="utf8") as handle:
        table = json.load(handle)
    rows = table["corrections"]
    hand_traits = {r["id"]: r for r in rows
                   if r.get("kind") == "traits" and r.get("generated") != MARKER}

    generated, kept, problems = [], [], []
    for cid in sorted(engine):
        current = [t for t in (engine[cid]["traits"] or []) if t]
        # Joined shape is one string that is NOT itself an official trait — "Rocks Pirates" is a
        # single trait containing a space, not a join, and "NULL" is the importer's placeholder
        # for an absent field, a separate defect class that is not this tool's problem.
        joined = (len(current) == 1 and current[0] not in vocab
                  and current[0] not in ("", "NULL"))
        marked = next((r for r in rows if r["id"] == cid and r.get("generated") == MARKER), None)
        if joined:
            hand = hand_traits.get(cid)
            if hand is not None:
                if hand["from"] != current and sorted(hand["to"]) != sorted(current):
                    problems.append(f"{cid}: hand row from={hand['from']!r} but the engine holds "
                                    f"{current!r} — re-adjudicate on Limitless")
                else:
                    kept.append(cid)
                continue
            theirs = dataset.get(cid)
            tokens = tokenize(current[0])
            if theirs and tokens and sorted(tokens) == sorted(theirs):
                generated.append({
                    "id": cid,
                    "kind": "traits",
                    "field": "traits",
                    "from": current,
                    "to": theirs,
                    "standard": not ae.is_rotated(cid.split("-")[0]) and not cid.startswith("P-"),
                    "verified": VERIFIED,
                    "why": WHY,
                    "generated": MARKER,
                })
            else:
                problems.append(f"{cid}: joined traits {current!r} fail tokenisation or disagree "
                                f"with the mirror ({theirs}) — needs a hand-adjudicated row")
        elif marked is not None:
            if sorted(current) != sorted(marked["to"]):
                problems.append(f"{cid}: split row is stale — engine holds {current!r}, row wants "
                                f"{marked['to']!r}; re-run on a pristine tree or re-adjudicate")
            else:
                # Already applied in this tree; the row stays wanted for the next fresh clone.
                generated.append(marked)

    if problems:
        for problem in problems:
            print(f"  REFUSED  {problem}", file=sys.stderr)
        return 1

    table["corrections"] = [r for r in rows if r.get("generated") != MARKER] + generated
    text = json.dumps(table, indent=2, ensure_ascii=False) + "\n"
    with open(TABLE, encoding="utf8") as handle:
        old = handle.read()
    if text == old:
        print(f"table unchanged: {len(generated)} generated rows, "
              f"{len(kept)} hand-adjudicated joined cards kept")
        return 0
    if args.check:
        print(f"split rows out of date — run `python3 tools/split_traits.py`", file=sys.stderr)
        return 1
    with open(TABLE, "w", encoding="utf8") as handle:
        handle.write(text)
    print(f"table rewritten: {len(generated)} generated split rows "
          f"({len(kept)} hand-adjudicated joined cards kept), "
          f"{len(table['corrections'])} corrections total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
