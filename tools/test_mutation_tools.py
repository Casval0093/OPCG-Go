#!/usr/bin/env python3
"""Regression tests for the attribution and batching that the mutation sweep rests on.

Each test here pins a property whose failure would produce a WRONG measurement rather than an
error — the class of defect this repo keeps getting burned by. In particular:

  * attribution by imported symbol, because attribution by id-mention under-reported `OP05-098`
    Enel's coverage from 26 files to 1 and turned a killed mutant into a reported survivor;
  * inert files kept out of coverage, because a `validateCardAbility()` stub cannot fail and
    counting it as a test would silently launder 1594 files into "covered";
  * the batching disjointness invariant, because a batch that mixes two cards sharing a test file
    can credit one card's kill to another — a false green with no symptom.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import card_deps  # noqa: E402
import mutation_check as mc  # noqa: E402
import mutation_sweep as ms  # noqa: E402

CARD = '''import type {{ CharacterCard }} from "@tcg/op-types";

export const {sym}: CharacterCard = {{
  id: "{cid}",
  cardType: "character",
  power: 5000,
  effects: {{
    effects: [
      {{
        trigger: "onPlay",
        actions: [
          {{
            action: "ko",
            target: {{
              player: "opponent",
              zones: ["character"],
              filters: [{{ filter: "power", comparison: "lte", value: 5000 }}],
            }},
          }},
        ],
      }},
    ],
  }},
}};
'''


def _tree(root: str, cards: list[tuple[str, str]], tests: dict[str, str]) -> tuple[str, str]:
    """Build a minimal engine + cards package. Returns (engine, cards_root)."""
    cards_root = os.path.join(root, "packages", "cards", "src", "cards")
    engine = os.path.join(root, "packages", "engine")
    for cid, sym in cards:
        set_id = cid.split("-")[0]
        d = os.path.join(cards_root, set_id, "characters")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{cid.lower()}.ts"), "w", encoding="utf-8") as fh:
            fh.write(CARD.format(sym=sym, cid=cid))
    for rel, src in tests.items():
        p = os.path.join(engine, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(src)
    os.makedirs(os.path.join(engine, "src"), exist_ok=True)
    os.makedirs(os.path.join(engine, "tests"), exist_ok=True)
    return engine, cards_root


class TestAttribution(unittest.TestCase):
    def test_symbol_import_counts_even_without_the_id_in_the_text(self):
        """The Enel case: a test that imports the card but never writes its id."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"tests/a.test.ts":
                 'import { op05Enel098 } from "@tcg/op-cards";\n'
                 'test("x", () => { expect(op05Enel098).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/a.test.ts"])

    def test_id_string_counts_too(self):
        """The getCard("OP05-098") route, which no import scan would see."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"tests/b.test.ts":
                 'test("x", () => { expect(getCard("OP05-098")).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/b.test.ts"])

    def test_inert_file_is_not_coverage(self):
        """A stubbed validateCardAbility() file must never appear as a runnable test."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"src/cards/OP05/characters/098.test.ts":
                 'import { op05Enel098 } from "@tcg/op-cards";\n'
                 'test("validates", () => { validateCardAbility(op05Enel098); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), [])
            self.assertEqual(a.inert_files("OP05-098"),
                             ["src/cards/OP05/characters/098.test.ts"])

    def test_shared_helper_is_followed(self):
        """A test whose cases live in a *.shared.ts helper still depends on that helper's cards.

        Without this the disjointness invariant is unsound: two cards could look independent while
        a shared helper exercises both.
        """
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"tests/helper.shared.ts":
                 'import { op05Enel098 } from "@tcg/op-cards";\nexport const x = op05Enel098;\n',
                 "tests/c.test.ts":
                 'import { x } from "./helper.shared.ts";\n'
                 'test("x", () => { expect(x).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/c.test.ts"])

    def test_helper_chain_is_followed_to_any_depth(self):
        """A test -> helper -> helper -> card chain must still attribute the card. One level of
        indirection was all the first implementation followed, which would silently under-report
        coverage and, worse, let two cards that share a test land in the same batch."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"tests/inner.shared.ts":
                 'import { op05Enel098 } from "@tcg/op-cards";\nexport const y = op05Enel098;\n',
                 "tests/outer.shared.ts":
                 'import { y } from "./inner.shared.ts";\nexport const x = y;\n',
                 "tests/d.test.ts":
                 'import { x } from "./outer.shared.ts";\n'
                 'test("x", () => { expect(x).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/d.test.ts"])

    def test_helper_cycle_does_not_hang(self):
        """Helpers may import each other. Termination is guaranteed twice over — by the explicit
        `if nxt in seen` guard and by the `- seen` filter on the frontier — and the two are
        MUTUALLY redundant: measured, removing either one alone still terminates, removing both
        hangs. So this test cannot fail on one of them, only on both, and then it fails as a hang
        rather than an assertion. Do not 'simplify' either mechanism away on the grounds that the
        suite stays green when you drop it."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098")],
                {"tests/a.shared.ts":
                 'import { b } from "./b.shared.ts";\n'
                 'import { op05Enel098 } from "@tcg/op-cards";\nexport const a = [b, op05Enel098];\n',
                 "tests/b.shared.ts":
                 'import { a } from "./a.shared.ts";\nexport const b = a;\n',
                 "tests/e.test.ts":
                 'import { a } from "./a.shared.ts";\n'
                 'test("x", () => { expect(a).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/e.test.ts"])

    def test_engine_source_imports_are_not_followed(self):
        """The stop rule, and it is the load-bearing half. 22 real test files import
        `src/index.ts`, which re-exports the whole card barrel; following that edge would make
        every test depend on every card, collapse every batch to one card, and destroy the
        attribution while looking more thorough."""
        with tempfile.TemporaryDirectory() as root:
            engine, cards_root = _tree(
                root, [("OP05-098", "op05Enel098"), ("OP06-054", "op06Borsalino054")],
                {"src/index.ts":
                 'import { op06Borsalino054 } from "@tcg/op-cards";\n'
                 'export const engine = op06Borsalino054;\n',
                 "tests/f.test.ts":
                 'import { engine } from "../src/index.ts";\n'
                 'import { op05Enel098 } from "@tcg/op-cards";\n'
                 'test("x", () => { expect(engine && op05Enel098).toBeTruthy(); });\n'},
            )
            a = card_deps.Attribution(engine, cards_root)
            self.assertEqual(a.files("OP05-098"), ["tests/f.test.ts"])
            self.assertEqual(a.files("OP06-054"), [],
                             "importing engine source must not attribute its cards")

    def test_variant_printing_id_is_matched(self):
        """`PRB02-006_p2` has an underscore; a trailing \\b in the id regex drops it."""
        self.assertEqual(card_deps.CARD_ID_RE.findall("see PRB02-006_p2 here"), ["PRB02-006_p2"])
        self.assertEqual(card_deps.ID_STRING_RE.findall('"PRB02-006_p2"'), ["PRB02-006_p2"])

    def test_encoded_defs_reads_a_variant_id(self):
        with tempfile.TemporaryDirectory() as root:
            _e, cards_root = _tree(root, [("PRB02-006_p2", "prb02Zoro006p2")], {})
            got = card_deps.encoded_defs(cards_root, "PRB02")
            self.assertEqual([c for c, _p, _f in got], ["PRB02-006_p2"])


class TestBatching(unittest.TestCase):
    def test_cards_sharing_a_file_are_never_batched_together(self):
        """The safety invariant the whole speedup rests on."""
        attr = {"A": ["f1", "f2"], "B": ["f2"], "C": ["f3"], "D": ["f3", "f4"], "E": ["f5"]}
        batches = ms._batches(list(attr), attr, cap=99)
        self.assertEqual(sorted(c for b in batches for c in b), ["A", "B", "C", "D", "E"])
        for b in batches:
            seen: set[str] = set()
            for c in b:
                files = set(attr[c])
                self.assertFalse(files & seen, f"{c} shares a file with an earlier member of {b}")
                seen |= files

    def test_cap_is_respected(self):
        attr = {str(i): [f"f{i}"] for i in range(10)}
        for b in ms._batches(list(attr), attr, cap=3):
            self.assertLessEqual(len(b), 3)

    def test_every_card_is_placed_exactly_once(self):
        attr = {"A": ["f1"], "B": ["f1"], "C": ["f1"]}
        batches = ms._batches(list(attr), attr, cap=99)
        flat = [c for b in batches for c in b]
        self.assertEqual(sorted(flat), ["A", "B", "C"])
        self.assertEqual(len(flat), len(set(flat)))
        self.assertEqual(len(batches), 3)  # all conflict, so one per batch


class TestFalseGreenGuards(unittest.TestCase):
    def _run(self, rc: int, out: str, files: list[str]):
        class Proc:
            returncode = rc
            stdout = out
            stderr = ""

        orig = mc.subprocess.run
        mc.subprocess.run = lambda *a, **k: Proc()
        try:
            return mc._run_tests("/nonexistent", files)
        finally:
            mc.subprocess.run = orig

    def test_no_test_files_found_reports_zero_files(self):
        """`vp test run` exits 1 when its filter matches nothing. Counting that as a red test is
        how a sweep reports every mutant killed while running nothing at all.

        BOTH return codes are asserted on purpose. With only the rc=1 case this test passed even
        with the guard deleted, because the fallback path happens to yield 0 for a failing run —
        it pinned the fallback, not the guard. Found by mutating the guard out and watching the
        test stay green: the exact defect class `mutation_check.py` exists to catch, in its own
        test file."""
        for rc in (0, 1):
            ok, n = self._run(rc, "No test files found, exiting with code 1\n",
                              ["tests/nope.test.ts"])
            self.assertEqual(n, 0, f"a run that selected no file must report 0 files (rc={rc})")

    def test_file_count_is_parsed_from_a_passing_run(self):
        class Proc:
            returncode = 0
            stdout = " Test Files  2 passed (2)\n      Tests  6 passed (6)\n"
            stderr = ""

        orig = mc.subprocess.run
        mc.subprocess.run = lambda *a, **k: Proc()
        try:
            ok, n = mc._run_tests("/nonexistent", ["a", "b"])
        finally:
            mc.subprocess.run = orig
        self.assertTrue(ok)
        self.assertEqual(n, 2)


class TestMutants(unittest.TestCase):
    def test_the_fixture_card_yields_the_expected_decision_surface(self):
        """Pins that the operators actually fire on a realistic encoding — a guard against a
        refactor quietly reducing the sweep to zero mutants everywhere."""
        src = CARD.format(sym="opTest001", cid="OP05-001")
        labels = [m.label for m in mc._mutants(src)]
        self.assertTrue(any(x.startswith("delete filter:power") for x in labels), labels)
        self.assertTrue(any(x.startswith("comparison lte->gte") for x in labels), labels)
        self.assertTrue(any(x.startswith("value 5000->4000") for x in labels), labels)

    def test_every_once_per_turn_guard_is_mutated_not_just_the_first(self):
        """A card can carry two OPT guards (OP12-081 does). `re.search` mutated only the first, so
        the second was reported as covered when it had never been perturbed."""
        src = ("effects: {\n  a: { oncePerTurn: true },\n"
               "  b: { oncePerTurn: true },\n  c: { oncePerTurn: true },\n}\n")
        labels = [m.label for m in mc._mutants(src) if m.label.startswith("drop oncePerTurn")]
        self.assertEqual(len(labels), 3, labels)
        self.assertEqual(len(set(labels)), 3, "each site must be labelled with its own line")

    def test_comments_are_never_mutated(self):
        src = 'const a = 1;\n// zone: "field" is discussed here\nconst b = 2;\n'
        self.assertEqual(mc._mutants(src), [])


class TestWidenedOperators(unittest.TestCase):
    """The six operators adopted from docs/mutation-operators.md ranks 1–6.

    Each guard here exists because its absence produces a mutant that does not type-check
    (`predicate:` is a required Condition) or an equivalent mutant (shuffleDeck's player flip)
    rather than a finding. The tests pin both the fire and the no-fire direction, so a guard
    deleted out of the tool turns a test red.
    """

    @staticmethod
    def _labels(src: str) -> list[str]:
        return [m.label for m in mc._mutants(src)]

    def test_player_flip_fires_and_swaps_both_ways(self):
        src = 'effects: {\n  a: { player: "self" },\n  b: { player: "opponent" },\n}\n'
        labels = self._labels(src)
        self.assertTrue(any(x.startswith("player self->opponent") for x in labels), labels)
        self.assertTrue(any(x.startswith("player opponent->self") for x in labels), labels)

    def test_player_flip_skips_self_targeting_and_shuffle_deck(self):
        """`self: true` already pins the side, and flipping who shuffles is an equivalent
        mutant — the opponent's deck order is as unknown to the test as your own."""
        src = (
            'effects: {\n'
            '  a: { player: "self", zones: ["character"], self: true },\n'
            '  b: { action: "shuffleDeck", player: "opponent" },\n'
            '}\n'
        )
        self.assertEqual([x for x in self._labels(src) if x.startswith("player ")], [])

    def test_player_flip_skips_sites_outside_the_effects_body(self):
        """Scoping is what keeps a card's own metadata from becoming a mutation site."""
        src = 'const meta = { player: "self" };\neffects: {\n  a: { amount: 1 },\n}\n'
        self.assertEqual([x for x in self._labels(src) if x.startswith("player ")], [])

    def test_condition_array_element_is_deleted_with_its_comma(self):
        src = ('effects: {\n  conditions: [{ condition: "turn", value: "your" }, '
               '{ condition: "donAttached", amount: 1 }],\n}\n')
        muts = [m for m in mc._mutants(src) if m.label.startswith("delete condition:")]
        self.assertEqual(len(muts), 2, [m.label for m in muts])
        for m in muts:
            self.assertNotIn(", ,", m.source)
            self.assertNotIn("[,", m.source)

    def test_singular_condition_deletes_the_key_with_the_object(self):
        """Deleting only the object emits `condition: ,` — a mutant that cannot compile is a
        false survivor waiting to be reported."""
        src = ('effects: {\n  actions: [{ action: "ko",\n'
               '    condition: { condition: "turn", value: "your" },\n  }],\n}\n')
        muts = [m for m in mc._mutants(src) if m.label.startswith("delete condition:turn")]
        self.assertEqual(len(muts), 1)
        self.assertNotIn("condition:", muts[0].source)
        self.assertIn('action: "ko"', muts[0].source)

    def test_predicate_is_never_deleted(self):
        """`ConditionalAction.predicate` is a REQUIRED Condition — removing it breaks the
        build, and a mutant that does not compile is not a measurement."""
        src = ('effects: {\n  actions: [{ action: "conditional",\n'
               '    predicate: { condition: "leaderColor", color: "red" },\n'
               '    whenTrue: [],\n  }],\n}\n')
        self.assertEqual(
            [x for x in self._labels(src) if x.startswith("delete condition:")], [])

    def test_negative_value_sign_flip_and_power_step(self):
        """The lost-`−` defect class: every debuff was unreachable while the threshold regex
        could not match a leading minus."""
        src = 'effects: {\n  f: { filter: "power", comparison: "gte", value: -3000 },\n}\n'
        labels = self._labels(src)
        self.assertTrue(any(x.startswith("value -3000->3000") for x in labels), labels)
        self.assertTrue(any(x.startswith("value -3000->-2000") for x in labels), labels)

    def test_negative_value_below_one_power_step_flips_sign_only(self):
        src = 'effects: {\n  f: { filter: "power", comparison: "gte", value: -2 },\n}\n'
        labels = [x for x in self._labels(src) if x.startswith("value ")]
        self.assertEqual(len(labels), 1, labels)
        self.assertTrue(labels[0].startswith("value -2->2"), labels)

    def test_zones_drop_leader_from_both_positions(self):
        first = 'effects: {\n  t: { zones: ["leader", "character"] },\n}\n'
        last = 'effects: {\n  t: { zones: ["character", "leader"] },\n}\n'
        for src in (first, last):
            muts = [m for m in mc._mutants(src) if m.label.startswith("zones drop")]
            self.assertEqual(len(muts), 1, src)
            self.assertIn('zones: ["character"]', re.sub(r"\s+", " ", muts[0].source))

    def test_zones_single_leader_is_not_narrowed_to_empty(self):
        src = 'effects: {\n  t: { zones: ["leader"] },\n}\n'
        self.assertEqual([x for x in self._labels(src) if x.startswith("zones drop")], [])

    def test_amount_lowers_by_one_but_not_inside_upto(self):
        """`upTo: true` makes the amount an upper bound the fixture may not saturate; lowering
        it there manufactures survivors, so the site is skipped. Plain amounts narrow."""
        plain = 'effects: {\n  c: { amount: 3 },\n}\n'
        upto = 'effects: {\n  c: { amount: 3, upTo: true },\n}\n'
        one = 'effects: {\n  c: { amount: 1 },\n}\n'
        labels = self._labels(plain)
        self.assertTrue(any(x.startswith("amount 3->2") for x in labels), labels)
        self.assertEqual([x for x in self._labels(upto) if x.startswith("amount ")], [])
        self.assertEqual([x for x in self._labels(one) if x.startswith("amount ")], [])

    def test_keywords_drops_each_member(self):
        src = 'effects: {\n  keywords: ["rush", "blocker"],\n}\n'
        muts = [m for m in mc._mutants(src) if m.label.startswith("keywords drop")]
        self.assertEqual(len(muts), 2, [m.label for m in muts])
        self.assertIn('keywords: ["blocker"]', muts[0].source if '"rush"' in muts[0].label
                      else muts[1].source)


if __name__ == "__main__":
    unittest.main()
