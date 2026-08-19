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

    def test_comments_are_never_mutated(self):
        src = 'const a = 1;\n// zone: "field" is discussed here\nconst b = 2;\n'
        self.assertEqual(mc._mutants(src), [])


if __name__ == "__main__":
    unittest.main()
