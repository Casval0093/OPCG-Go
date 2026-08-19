#!/usr/bin/env python3
"""Which test files can actually exercise which card — the attribution both mutation tools use.

Getting this wrong is the difference between a measurement and a number. Three ways it can be
wrong, all of which bit during development:

  * **By filename.** Upstream files the same card under three incompatible conventions
    (`tests/cards/characters/op06-054-borsalino.test.ts`,
    `src/cards/OP06/characters/051-borsalino-sp.test.ts`, and our flat graft
    `tests/cards/OP16/001-portgas-d-ace.test.ts`), so a derived path misses tests that exist. Worse,
    `vp test run` takes its argument as a substring filter and a filter matching nothing exits 1 —
    which a returncode check reads as a red test, i.e. as a killed mutant. Silent false green.

  * **By card id in the file's text.** Better, but too narrow: a test names the cards it uses by
    imported symbol (`op05Sabo001`), and only sometimes writes the id string. Attribution by id
    alone gave `OP05-098` Enel exactly one file when 26 files import it — Enel is a stock fixture
    leader — and so reported a survivor that the suite in fact catches.

  * **Counting files that cannot fail.** 1594 of the engine's 3665 test files are a lone
    `validateCardAbility(card)` call, and upstream stubbed that function's body out to
    `void card; assert.ok(true);`. They can never go red, so they are not coverage; they are
    tracked separately as `inert` and never run.

So attribution is by IMPORTED SYMBOL, resolved one level through local `*.shared.ts` helpers
(several `tests/cards` files get their cases from a helper that imports the cards itself), unioned
with card ids named as strings (the `getCard("OP06-054")` route).

The question this answers is deliberately the broad one — *if this encoding were wrong, would
anything in the suite catch it?* — not the narrow *is this card's own test load-bearing?*. A
survivor under broad attribution is the stronger finding: nothing anywhere catches it.

Whole-catalog tests are excluded too: they iterate every card, so they would go red under any
mutation and could credit a kill to any card in a batch.
"""

from __future__ import annotations

import os
import re

TYPES = ("leaders", "characters", "events", "stages")
# `_p2` variant printings put an underscore in the id, which a trailing \b will not match.
CARD_ID_RE = re.compile(r"\b((?:OP|EB|ST|PRB|P)\d{2}-\d{3}(?:_p\d)?)")
SYMBOL_RE = re.compile(r"^export const (\w+)\s*:", re.M)
IMPORT_RE = re.compile(r'import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"', re.S)
ID_STRING_RE = re.compile(r'"((?:OP|EB|ST|PRB|P)\d{2}-\d{3}(?:_p\d)?)"')
CATALOG_HINT = re.compile(r"\bgetAllCards\b|\bcardCatalog\b|Object\.values\(cards\)|test\.each\(")
CATALOG_MIN_CARDS = 30


def encoded_defs(cards_root: str, set_id: str) -> list[tuple[str, str, str]]:
    """(card_id, path, filename) for each card in a set carrying a hand-authored encoding."""
    out = []
    for kind in TYPES:
        d = os.path.join(cards_root, set_id, kind)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".ts") or fn.endswith(".i18n.ts") or fn == "index.ts":
                continue
            path = os.path.join(d, fn)
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            if "effects: {" not in src:
                continue  # vanilla or a generated shell — nothing to mutate
            m = re.search(r'id:\s*"([A-Za-z0-9_-]+)"', src)
            out.append((m.group(1) if m else fn, path, fn))
    return out


def symbol_map(cards_root: str) -> dict[str, str]:
    """exported symbol -> card id."""
    out: dict[str, str] = {}
    for set_id in sorted(os.listdir(cards_root)):
        if not os.path.isdir(os.path.join(cards_root, set_id)):
            continue
        for kind in TYPES:
            d = os.path.join(cards_root, set_id, kind)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".ts") or fn.endswith(".i18n.ts") or fn == "index.ts":
                    continue
                with open(os.path.join(d, fn), encoding="utf-8") as fh:
                    src = fh.read()
                cid = re.search(r'id:\s*"([A-Za-z0-9_-]+)"', src)
                sym = SYMBOL_RE.search(src)
                if cid and sym:
                    out[sym.group(1)] = cid.group(1)
    return out


class Attribution:
    """attr[card] = engine-relative test files that can exercise it."""

    def __init__(self, engine: str, cards_root: str):
        self.engine = engine
        self.symbols = symbol_map(cards_root)
        raw: dict[str, str] = {}
        for sub in ("src", "tests"):
            root = os.path.join(engine, sub)
            for dirpath, _d, files in os.walk(root):
                if "node_modules" in dirpath:
                    continue
                for fn in files:
                    if fn.endswith(".ts"):
                        p = os.path.join(dirpath, fn)
                        with open(p, encoding="utf-8", errors="replace") as fh:
                            raw[p] = fh.read()

        def direct(path: str) -> tuple[set[str], set[str]]:
            src = raw[path]
            cards = set(ID_STRING_RE.findall(src))
            local: set[str] = set()
            for names, spec in IMPORT_RE.findall(src):
                for n in names.split(","):
                    n = n.strip().split(" as ")[0].strip()
                    if n in self.symbols:
                        cards.add(self.symbols[n])
                if spec.startswith("."):
                    cand = os.path.normpath(os.path.join(os.path.dirname(path), spec))
                    if cand in raw:
                        local.add(cand)
            return cards, local

        self.deps: dict[str, set[str]] = {}
        self.inert: set[str] = set()
        self.catalog: set[str] = set()
        for p, src in raw.items():
            if not p.endswith(".test.ts"):
                continue
            rel = os.path.relpath(p, engine)
            if "validateCardAbility(" in src and "expect(" not in src:
                self.inert.add(rel)
                continue
            cards, local = direct(p)
            for lp in local:
                c2, _ = direct(lp)
                cards |= c2
            if CATALOG_HINT.search(src) and len(cards) > CATALOG_MIN_CARDS:
                self.catalog.add(rel)
                continue
            self.deps[rel] = cards

        self.attr: dict[str, list[str]] = {}
        for rel, cards in self.deps.items():
            for c in cards:
                self.attr.setdefault(c, []).append(rel)
        for v in self.attr.values():
            v.sort()

        # Inert files are tracked per card so a card whose ONLY coverage is a stub can be reported
        # as "no effective test" rather than as "no test file" — a different and more useful fact.
        self.inert_attr: dict[str, list[str]] = {}
        for rel in self.inert:
            p = os.path.join(engine, rel)
            cards, _ = direct(p)
            for c in cards:
                self.inert_attr.setdefault(c, []).append(rel)

    def files(self, card_id: str) -> list[str]:
        return self.attr.get(card_id, [])

    def inert_files(self, card_id: str) -> list[str]:
        return self.inert_attr.get(card_id, [])
