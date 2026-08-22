#!/usr/bin/env python3
"""Tests for tools/correct_cards.py.

    ./.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v

Every case below is a defect this tool actually had, not a hypothetical. The tool edits a gitignored
`vendor/` tree that bootstrap recreates, so a silent no-op is indistinguishable from success until a
simulation runs on uncorrected data. The assertions are therefore about the *bytes on disk* and the
*exit code*, never about the wording of a report line.

Fixtures are tiny synthetic `.ts` files under a `tempfile` root, shaped like the engine's real ones
(two-space top-level indentation, wrapped long values, an `.i18n.ts` sidecar). The real `vendor/`
tree is never touched and nothing here reaches the network.

Stdlib unittest only, matching the other tools' tests.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import correct_cards  # noqa: E402

HEADER = 'import type { CharacterCard } from "@tcg/op-types";\n\n'

# Written after the closing `};` of a literal. Every scanner test asserts this stays OUTSIDE the
# span, which is exactly what a runaway scan (a phantom string opened by an apostrophe, a brace
# hidden in a comment) gets wrong.
SENTINEL = "\nconst sentinel = 1;\n"


def card(export: str, card_id: str, *fields: str) -> str:
    """One engine-shaped `export const x: CharacterCard = {...};` literal.

    `fields` are emitted verbatim at the two-space indentation the engine uses, because `field_span`
    anchors on `^  field:` -- a re-indented fixture would silently match nothing and every assertion
    below would pass for the wrong reason.
    """
    body = "".join(f"  {field}\n" for field in fields)
    return f'export const {export}: CharacterCard = {{\n  id: "{card_id}",\n{body}}};\n'


def correction(card_id: str, kind: str, field: str, frm, to) -> dict:
    """A table row, carrying the same keys data/card-corrections.json does."""
    return {
        "id": card_id,
        "kind": kind,
        "field": field,
        "from": frm,
        "to": to,
        "standard": True,
        "why": "synthetic fixture",
        "verified": "2026-08-19",
    }


class ScannerTest(unittest.TestCase):
    """`skip_noise` / `balanced_span`: the literal's extent must survive comments and strings.

    This is the mis-scoping that hit 68 definitions. A scanner that gets the span wrong does not
    error -- it corrects the wrong card, or reports a field as absent and inserts a duplicate.
    """

    def span_text(self, source: str, card_id: str) -> str:
        start, end = correct_cards.find_block(source, card_id)
        return source[start:end]

    def test_line_comment_with_an_apostrophe_does_not_run_the_scan_to_eof(self) -> None:
        # One apostrophe, so a scanner that reads `//` as ordinary source opens a string here and
        # never closes it: balanced_span runs to EOF and raises instead of returning the literal.
        source = HEADER + card(
            "op15Ace001",
            "OP15-001",
            'power: 5000,',
            'effects: {',
            "    // the card's own effect only counts bodies K.O.d this turn",
            "    effects: [],",
            "  },",
            "i18n: op15Ace001I18n,",
        ) + SENTINEL

        text = self.span_text(source, "OP15-001")

        self.assertTrue(text.endswith("}"), text[-40:])
        self.assertIn("i18n: op15Ace001I18n,", text)
        self.assertNotIn("sentinel", text)

    def test_block_comment_hiding_a_brace_does_not_close_the_literal(self) -> None:
        # The `}` inside the comment would decrement depth to zero one nesting level early, ending
        # the span before the card's last fields -- a truncation, not a crash.
        source = HEADER + card(
            "op15Ace001",
            "OP15-001",
            "effects: {",
            "    /* upstream left a stray } in this note */",
            "    effects: [],",
            "  },",
            "i18n: op15Ace001I18n,",
        ) + SENTINEL

        text = self.span_text(source, "OP15-001")

        self.assertIn("i18n: op15Ace001I18n,", text)
        self.assertNotIn("sentinel", text)

    def test_url_containing_a_double_slash_is_not_read_as_a_comment(self) -> None:
        # Every printing carries an imageUrl. If the `//` in it were treated as a comment the scan
        # would skip to end of line and lose the `}` and `]` that close on the same line.
        source = HEADER + card(
            "op15Ace001",
            "OP15-001",
            'printings: [{ id: "OP15-001", imageUrl: "https://example.test/a.jpg" }],',
            "power: 5000,",
        ) + SENTINEL

        text = self.span_text(source, "OP15-001")

        self.assertIn("power: 5000,", text)
        self.assertNotIn("sentinel", text)

    def test_unbalanced_literal_raises_rather_than_returning_a_guess(self) -> None:
        source = HEADER + 'export const broken: CharacterCard = {\n  id: "OP15-001",\n'
        opening = correct_cards.EXPORT_RE.search(source).end() - 1
        with self.assertRaises(ValueError):
            correct_cards.balanced_span(source, opening)


class CorrectCardsTest(unittest.TestCase):
    """Shared plumbing: a throwaway cards root plus a throwaway correction table."""

    def setUp(self) -> None:
        self.root = tempfile.mkdtemp(prefix="correct-cards-test-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.cards = os.path.join(self.root, "cards")
        os.makedirs(self.cards)

    def write(self, relpath: str, text: str) -> None:
        path = os.path.join(self.cards, relpath)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf8") as handle:
            handle.write(text)

    def read(self, relpath: str) -> str:
        with open(os.path.join(self.cards, relpath), encoding="utf8") as handle:
            return handle.read()

    def run_tool(self, *corrections: dict, check: bool = False, only: str | None = None):
        """(exit code, stdout+stderr) from a real main() run against the temp fixture."""
        table = os.path.join(self.root, "table.json")
        with open(table, "w", encoding="utf8") as handle:
            json.dump({"corrections": list(corrections)}, handle)
        argv = ["--cards-root", self.cards, "--table", table]
        if check:
            argv.append("--check")
        if only:
            argv += ["--only", only]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = correct_cards.main(argv)
        return code, out.getvalue() + err.getvalue()


class BlockScopeTest(CorrectCardsTest):
    """A correction belongs to one card literal, not to the file.

    PRB01/PRB02 pack many definitions per file, so a file-wide substitution would corrupt the
    neighbour -- and the neighbour is likely to hold the same value, since these are stat numbers.
    """

    # Both cards print counter 4000, which is what makes this discriminating: a file-wide
    # `replace("4000", "2000")` passes every assertion about the target and still corrupts this one.
    NEIGHBOUR = card(
        "prb01Zoro001",
        "PRB01-001",
        'cardType: "character",',
        "cost: 4,",
        "power: 6000,",
        "counter: 4000,",
        'traits: ["Straw Hat Crew"],',
    )
    TARGET = card(
        "prb01Kizaru054",
        "OP06-054",
        'cardType: "character",',
        "cost: 5,",
        "power: 7000,",
        "counter: 4000,",
        'traits: ["Navy"],',
    )

    def test_only_the_matching_definition_is_rewritten(self) -> None:
        self.write("PRB01/index.ts", HEADER + self.NEIGHBOUR + "\n" + self.TARGET)

        code, text = self.run_tool(correction("OP06-054", "number", "counter", 4000, 2000))

        after = self.read("PRB01/index.ts")
        self.assertEqual(code, 0, text)
        # The neighbour is asserted byte-identical, not merely "still has a counter".
        self.assertIn(self.NEIGHBOUR, after)
        self.assertIn("counter: 2000,", after)
        self.assertEqual(after.count("counter: 4000,"), 1)

    def test_a_card_absent_from_the_catalog_is_reported_missing_and_gates(self) -> None:
        self.write("PRB01/index.ts", HEADER + self.NEIGHBOUR)

        code, text = self.run_tool(correction("OP99-999", "number", "counter", 4000, 2000))

        self.assertIn("MISSING", text)
        self.assertEqual(code, 1)

    def test_only_restricts_the_run_to_the_named_card(self) -> None:
        self.write("PRB01/index.ts", HEADER + self.NEIGHBOUR + "\n" + self.TARGET)

        code, _ = self.run_tool(
            correction("PRB01-001", "number", "counter", 4000, 2000),
            correction("OP06-054", "number", "counter", 4000, 2000),
            only="OP06-054",
        )

        self.assertEqual(code, 0)
        self.assertIn(self.NEIGHBOUR, self.read("PRB01/index.ts"))


class IdempotenceTest(CorrectCardsTest):
    """A second run must report `ok` and write nothing.

    bootstrap re-runs this tool on every fresh clone, and a correction that re-applies would stack
    (a second inserted key, a doubled replacement) rather than settle.
    """

    def seed(self) -> None:
        self.write("OP06/054-borsalino.ts", HEADER + card(
            "op06Borsalino054",
            "OP06-054",
            "cost: 5,",
            "power: 7000,",
            "counter: 4000,",
            'traits: ["Navy"],',
        ))

    def test_second_run_is_ok_not_applied_and_leaves_the_file_alone(self) -> None:
        self.seed()
        fix = correction("OP06-054", "number", "counter", 4000, 2000)

        first_code, first_text = self.run_tool(fix)
        applied = self.read("OP06/054-borsalino.ts")
        second_code, second_text = self.run_tool(fix)

        self.assertEqual((first_code, second_code), (0, 0))
        self.assertIn("applied", first_text)
        self.assertIn("already correct", second_text)
        self.assertIn("already-correct 1", second_text)
        # The report is not the point; the bytes are.
        self.assertEqual(self.read("OP06/054-borsalino.ts"), applied)

    def test_check_passes_once_the_correction_is_in_place(self) -> None:
        self.seed()
        fix = correction("OP06-054", "number", "counter", 4000, 2000)
        self.run_tool(fix)

        code, text = self.run_tool(fix, check=True)

        self.assertEqual(code, 0, text)
        self.assertIn("would-apply 0", text)


class DriftTest(CorrectCardsTest):
    """A value that is neither `from` nor `to` means upstream moved; refuse and gate.

    Applying anyway would overwrite an upstream change with a stale adjudication, and the whole
    point of the table is that neither side is authoritative.
    """

    def seed(self, counter_line: str) -> None:
        self.write("OP06/051-kuzan.ts", HEADER + card(
            "op06Kuzan051",
            "OP06-051",
            "cost: 4,",
            "power: 5000,",
            counter_line,
            'traits: ["Navy"],',
        ))

    def test_unexpected_current_value_is_refused_and_nothing_is_written(self) -> None:
        self.seed("counter: 3000,")
        before = self.read("OP06/051-kuzan.ts")

        code, text = self.run_tool(correction("OP06-051", "number", "counter", 4000, 2000))

        self.assertIn("DRIFT", text)
        self.assertIn("3000", text)  # the report names what it actually found
        self.assertEqual(code, 1)
        self.assertEqual(self.read("OP06/051-kuzan.ts"), before)

    def test_absent_field_with_a_non_null_from_is_also_drift(self) -> None:
        # `from: 4000` asserts the key was there. If it is gone, upstream deleted it and inserting
        # a replacement would be inventing data.
        self.seed('attribute: "special",')
        before = self.read("OP06/051-kuzan.ts")

        code, text = self.run_tool(correction("OP06-051", "number", "counter", 4000, 2000))

        self.assertIn("DRIFT", text)
        self.assertIn("<absent>", text)
        self.assertEqual(code, 1)
        self.assertEqual(self.read("OP06/051-kuzan.ts"), before)


class InsertionTest(CorrectCardsTest):
    """`from: null` inserts a key the engine omitted, in the engine's own field order.

    EB03-009 Makino has neither power nor counter, so both are inserted into the same literal in one
    run -- the second insertion has to anchor on the first.
    """

    def test_inserted_power_and_counter_land_in_the_engine_field_order(self) -> None:
        self.write("EB03/009-makino.ts", HEADER + card(
            "eb03Makino009",
            "EB03-009",
            'cardType: "character",',
            "cost: 1,",
            'traits: ["Windmill Village"],',
            'attribute: "wisdom",',
            "effect:",
            '    "[Activate: Main] You may rest this Character.",',
        ))

        code, text = self.run_tool(
            # Table order is counter-then-power, so power must still end up before counter.
            correction("EB03-009", "number", "counter", None, 2000),
            correction("EB03-009", "number", "power", None, 0),
        )

        after = self.read("EB03/009-makino.ts")
        self.assertEqual(code, 0, text)
        # `to: 0` is the trap: a falsy-zero check would treat this insertion as a no-op.
        self.assertIn("  power: 0,\n", after)
        self.assertIn("  counter: 2000,\n", after)
        order = [after.index(f"\n  {f}:") for f in
                 ("cost", "power", "counter", "traits", "attribute", "effect")]
        self.assertEqual(order, sorted(order), after)

    def test_inserted_traits_land_before_effect(self) -> None:
        self.write("EB03/034-whitebeard.ts", HEADER + card(
            "eb03Whitebeard034",
            "EB03-034",
            "cost: 9,",
            "power: 10000,",
            "counter: 1000,",
            "effect:",
            '    "[On Play] Draw 1 card.",',
        ))

        code, _ = self.run_tool(
            correction("EB03-034", "traits", "traits", None, ["Rocks Pirates"]))

        after = self.read("EB03/034-whitebeard.ts")
        self.assertEqual(code, 0)
        self.assertIn('  traits: ["Rocks Pirates"],\n', after)
        self.assertLess(after.index("\n  counter:"), after.index("\n  traits:"))
        self.assertLess(after.index("\n  traits:"), after.index("\n  effect:"))

    def test_insertion_point_is_the_first_present_anchor_in_insert_before(self) -> None:
        # Asserted against INSERT_BEFORE and field_span rather than a byte offset: `attribute` is
        # ahead of `effect` in the anchor list, so its absence must fall through to `effect`.
        block = (
            '{\n  id: "EB03-034",\n  counter: 1000,\n  effect:\n    "[On Play] Draw 1 card.",\n}'
        )
        self.assertEqual(correct_cards.INSERT_BEFORE["traits"][0], "attribute")
        self.assertNotIn("attribute:", block)
        self.assertEqual(
            correct_cards.insertion_point(block, "traits"),
            correct_cards.field_span(block, "effect")[0],
        )

    def test_no_anchor_raises_rather_than_appending_at_the_end(self) -> None:
        block = '{\n  id: "EB03-034",\n  cost: 9,\n}'
        with self.assertRaises(ValueError):
            correct_cards.insertion_point(block, "traits")


class ConstResolutionTest(CorrectCardsTest):
    """ST01 writes `traits: strawHat` against a file-level const.

    Reading the identifier instead of resolving it made all 13 ST01 cards look wrong when 12 were
    already right -- the worst failure mode here, because it produces confident bulk edits.
    """

    ST01 = (
        HEADER
        + 'const strawHat = ["Straw Hat Crew"];\n\n'
        + card(
            "st01Usopp002",
            "ST01-002",
            'cardType: "character",',
            "cost: 2,",
            "power: 2000,",
            "counter: 1000,",
            "traits: strawHat,",
            'attribute: "ranged",',
        )
    )

    def test_a_const_reference_is_resolved_and_rewritten_as_a_literal(self) -> None:
        self.write("ST01/index.ts", self.ST01)

        code, text = self.run_tool(correction(
            "ST01-002", "traits", "traits", ["Straw Hat Crew"], ["East Blue", "Straw Hat Crew"]))

        after = self.read("ST01/index.ts")
        self.assertEqual(code, 0, text)
        self.assertIn('  traits: ["East Blue", "Straw Hat Crew"],\n', after)
        self.assertNotIn("traits: strawHat", after)
        # The declaration itself is not the tool's business; other cards still reference it.
        self.assertIn('const strawHat = ["Straw Hat Crew"];', after)

    def test_a_const_reference_already_holding_the_wanted_value_reports_ok(self) -> None:
        self.write("ST01/index.ts", self.ST01)
        before = self.read("ST01/index.ts")

        code, text = self.run_tool(correction(
            "ST01-002", "traits", "traits", ["Supernovas"], ["Straw Hat Crew"]))

        self.assertEqual(code, 0, text)
        self.assertIn("already correct", text)
        self.assertEqual(self.read("ST01/index.ts"), before)

    def test_parse_current_resolves_traits_identifiers_only_when_the_const_is_known(self) -> None:
        consts = {"strawHat": '["Straw Hat Crew"]'}
        self.assertEqual(
            correct_cards.parse_current("traits", "strawHat", consts), ["Straw Hat Crew"])
        # Unknown identifier: return the raw text so the caller reports drift instead of guessing.
        self.assertEqual(correct_cards.parse_current("traits", "strawHat", {}), "strawHat")


class LineWrappingTest(CorrectCardsTest):
    """The rewritten field keeps the shape it had, so the diff stays on the value.

    A collapsed 200-character line is a formatting change on top of a data change, and `vp check`
    reports it as its own failure.
    """

    def test_a_wrapped_value_stays_wrapped_even_when_it_would_fit_inline(self) -> None:
        # "Draw 2 cards." fits inline comfortably, so only the `wrapped` flag can keep it wrapped.
        self.write("OP12/101-koby.ts", HEADER + card(
            "op12Koby101",
            "OP12-101",
            "cost: 3,",
            "power: 4000,",
            "trigger:",
            '    "Draw 1 card.",',
        ))

        code, _ = self.run_tool(
            correction("OP12-101", "string", "trigger", "Draw 1 card.", "Draw 2 cards."))

        after = self.read("OP12/101-koby.ts")
        self.assertEqual(code, 0)
        self.assertIn('  trigger:\n    "Draw 2 cards.",\n', after)

    def test_an_inline_value_stays_inline(self) -> None:
        self.write("OP14/019-akainu.ts", HEADER + card(
            "op14Akainu019",
            "OP14-019",
            "cost: 4,",
            "power: 5000,",
            'traits: ["Navy"],',
        ))

        code, _ = self.run_tool(correction("OP14-019", "number", "cost", 4, 1))

        after = self.read("OP14/019-akainu.ts")
        self.assertEqual(code, 0)
        self.assertIn("  cost: 1,\n", after)
        self.assertNotIn("  cost:\n", after)


class I18nMirrorTest(CorrectCardsTest):
    """An `effect` correction must also rewrite the `.i18n.ts` sidecar.

    The sidecar duplicates the display text. Left alone it contradicts the card it describes -- and
    this silently did nothing at first, because the search was done on the DECODED string while the
    file holds `\\n` as a two-character escape.
    """

    # A real newline in Python; the files below hold the two-character escape.
    OLD = "[Main] Trash 1 card from your hand.\n[Trigger] Draw 1 card."
    NEW = "[Main] Trash 1 card from your hand.\n[Trigger] Draw 2 cards."

    def seed(self) -> None:
        self.write("OP14/020-mihawk.ts", HEADER + card(
            "op14Mihawk020",
            "OP14-020",
            "cost: 5,",
            "power: 5000,",
            'traits: ["Seven Warlords of the Sea"],',
            "effect:",
            '    "[Main] Trash 1 card from your hand.\\n[Trigger] Draw 1 card.",',
            "i18n: op14Mihawk020I18n,",
        ))
        self.write("OP14/020-mihawk.i18n.ts", (
            'import type { OPCardI18n } from "@tcg/op-types";\n\n'
            "export const op14Mihawk020I18n: OPCardI18n = {\n"
            "  en: {\n"
            '    name: "Dracule Mihawk",\n'
            "    effect:\n"
            '      "[Main] Trash 1 card from your hand.\\n[Trigger] Draw 1 card.",\n'
            "  },\n"
            "};\n"
        ))

    def test_effect_correction_is_mirrored_into_the_sidecar(self) -> None:
        self.seed()

        code, text = self.run_tool(
            correction("OP14-020", "string", "effect", self.OLD, self.NEW))

        definition = self.read("OP14/020-mihawk.ts")
        sidecar = self.read("OP14/020-mihawk.i18n.ts")
        self.assertEqual(code, 0, text)
        self.assertIn("Draw 2 cards.", definition)
        # The regression: with a decoded-string comparison this file came back untouched.
        self.assertIn("Draw 2 cards.", sidecar)
        self.assertNotIn("Draw 1 card.", sidecar)
        self.assertIn("mirrored effect text", text)
        # The escape must survive as an escape -- a real newline here would break the TS literal.
        self.assertIn("your hand.\\n[Trigger]", sidecar)
        self.assertNotIn("\n[Trigger]", sidecar)

    def test_check_mode_leaves_both_the_definition_and_the_sidecar_alone(self) -> None:
        self.seed()
        before = (self.read("OP14/020-mihawk.ts"), self.read("OP14/020-mihawk.i18n.ts"))

        code, _ = self.run_tool(
            correction("OP14-020", "string", "effect", self.OLD, self.NEW), check=True)

        self.assertEqual(code, 1)
        self.assertEqual(
            (self.read("OP14/020-mihawk.ts"), self.read("OP14/020-mihawk.i18n.ts")), before)

    def test_mirroring_is_idempotent(self) -> None:
        self.seed()
        fix = correction("OP14-020", "string", "effect", self.OLD, self.NEW)
        self.run_tool(fix)
        applied = self.read("OP14/020-mihawk.i18n.ts")

        code, text = self.run_tool(fix)

        self.assertEqual(code, 0)
        self.assertIn("already correct", text)
        self.assertEqual(self.read("OP14/020-mihawk.i18n.ts"), applied)

    def test_a_card_with_no_sidecar_is_corrected_without_error(self) -> None:
        self.seed()
        os.remove(os.path.join(self.cards, "OP14/020-mihawk.i18n.ts"))

        code, _ = self.run_tool(
            correction("OP14-020", "string", "effect", self.OLD, self.NEW))

        self.assertEqual(code, 0)
        self.assertIn("Draw 2 cards.", self.read("OP14/020-mihawk.ts"))

    def test_a_non_effect_string_correction_does_not_touch_the_sidecar(self) -> None:
        # Deliberate: no `.i18n.ts` in the engine carries a `trigger` key, so mirroring a trigger
        # correction would have nothing to match and any "replacement" would be a false positive.
        self.seed()
        self.write("OP14/020-mihawk.ts",
                   self.read("OP14/020-mihawk.ts").replace(
                       "  i18n:", '  trigger: "Draw 1 card.",\n  i18n:'))
        before = self.read("OP14/020-mihawk.i18n.ts")

        code, _ = self.run_tool(
            correction("OP14-020", "string", "trigger", "Draw 1 card.", "Draw 2 cards."))

        self.assertEqual(code, 0)
        self.assertIn('trigger: "Draw 2 cards.",', self.read("OP14/020-mihawk.ts"))
        self.assertEqual(self.read("OP14/020-mihawk.i18n.ts"), before)


class CheckModeTest(CorrectCardsTest):
    """`--check` is the CI gate: it must write nothing and exit non-zero on anything outstanding.

    `patch_engine.py --check` used to print PENDING and return 0, so the gate accepted an unpatched
    engine. Same failure is available here, and an uncorrected engine is just as wrong to simulate
    against as a broken one.
    """

    def seed(self) -> None:
        self.write("OP08/082-hina.ts", HEADER + card(
            "op08Hina082",
            "OP08-082",
            "cost: 3,",
            "power: 4000,",
            "counter: 1000,",
            'traits: ["Navy"],',
        ))

    def test_outstanding_correction_gates_and_writes_nothing(self) -> None:
        self.seed()
        before = self.read("OP08/082-hina.ts")

        code, text = self.run_tool(
            correction("OP08-082", "number", "counter", 1000, 2000), check=True)

        self.assertIn("would-apply 1", text)
        self.assertEqual(code, 1)
        self.assertEqual(self.read("OP08/082-hina.ts"), before)

    def test_an_empty_or_absent_cards_root_gates_instead_of_reporting_a_clean_run(self) -> None:
        # The root exists but is empty here, so this is the MISSING path, not the absent-root one.
        code, text = self.run_tool(
            correction("OP08-082", "number", "counter", 1000, 2000), check=True)
        self.assertEqual(code, 1, text)

        shutil.rmtree(self.cards)
        code, _ = self.run_tool(
            correction("OP08-082", "number", "counter", 1000, 2000), check=True)
        self.assertEqual(code, 1)


class NonAsciiTest(CorrectCardsTest):
    """Card text carries literal U+2212 minus signs and circled DON!! digits.

    Re-emitting them as \\uXXXX escapes is a gratuitous diff on top of the data change, which is
    exactly what `vp check` reports as its own failure.
    """

    MINUS = "−"  # the character Bandai prints in "give -3000 power", not ASCII hyphen

    def test_render_keeps_non_ascii_literal(self) -> None:
        self.assertEqual(
            correct_cards.render("string", f"give {self.MINUS}3000 power"),
            f'"give {self.MINUS}3000 power"',
        )
        self.assertEqual(
            correct_cards.render("traits", ["Whitebeard Pirates"]), '["Whitebeard Pirates"]')

    def test_a_correction_writes_the_character_not_its_escape(self) -> None:
        old = f"[On Play] Give up to 1 Character {self.MINUS}2000 power."
        new = f"[On Play] Give up to 1 Character {self.MINUS}3000 power."
        self.write("OP02/013-marco.ts", HEADER + card(
            "op02Marco013",
            "OP02-013",
            "cost: 4,",
            "power: 5000,",
            "effect:",
            f'    "{old}",',
        ))

        code, _ = self.run_tool(correction("OP02-013", "string", "effect", old, new))

        after = self.read("OP02/013-marco.ts")
        self.assertEqual(code, 0)
        self.assertIn(f"{self.MINUS}3000", after)
        self.assertNotIn("\\u2212", after)


class FragmentTest(CorrectCardsTest):
    """`kind: "fragment"` patches inside the `effects:` encoding by anchored text.

    Used where the defect is a condition operand rather than a printed field, so there is no
    top-level key to address. Still block-scoped, and still refuses on drift.
    """

    def seed(self) -> None:
        self.write("OP06/054-borsalino.ts", HEADER + card(
            "op06Borsalino054",
            "OP06-054",
            "cost: 5,",
            "power: 7000,",
            "effects: {",
            "    permanentEffects: [",
            '      { conditions: [{ condition: "handCount", operator: "lte", value: 4 }] },',
            "    ],",
            "  },",
        ))

    def test_matching_fragment_is_replaced_once(self) -> None:
        self.seed()

        code, _ = self.run_tool(correction(
            "OP06-054", "fragment", "effects.permanentEffects[0].conditions[0].value",
            '"lte", value: 4', '"lte", value: 5'))

        after = self.read("OP06/054-borsalino.ts")
        self.assertEqual(code, 0)
        self.assertIn('"lte", value: 5', after)
        self.assertNotIn("value: 4", after)

    def test_absent_fragment_is_drift(self) -> None:
        self.seed()
        before = self.read("OP06/054-borsalino.ts")

        code, text = self.run_tool(correction(
            "OP06-054", "fragment", "effects.permanentEffects[0].conditions[0].value",
            '"gte", value: 4', '"gte", value: 5'))

        self.assertIn("DRIFT", text)
        self.assertEqual(code, 1)
        self.assertEqual(self.read("OP06/054-borsalino.ts"), before)


class FragmentAllTest(CorrectCardsTest):
    """`kind: "fragment-all"` rewrites EVERY occurrence of a literal inside the block.

    EB01-043 carries two identical `value: "CP",` filters; a plain fragment would fix the
    first and report the block correct forever after. `from` is checked first, so a block
    that was left half-rewritten still completes instead of reporting drift.
    """

    def seed(self) -> None:
        self.write("EB01/043-spandine.ts", HEADER + card(
            "eb01Spandine043",
            "EB01-043",
            "cost: 3,",
            "power: 4000,",
            "effects: {",
            "    effects: [",
            '      { filters: [{ filter: "trait", value: "CP", match: "includes" }] },',
            '      { filters: [{ filter: "trait", value: "CP", match: "includes" }] },',
            "    ],",
            "  },",
        ))

    ENUM = 'value: ["CP0", "CP9"],'

    def test_every_occurrence_is_replaced(self) -> None:
        self.seed()

        code, _ = self.run_tool(correction(
            "EB01-043", "fragment-all", "effects", 'value: "CP",', self.ENUM))

        after = self.read("EB01/043-spandine.ts")
        self.assertEqual(code, 0)
        self.assertEqual(after.count(self.ENUM), 2)
        self.assertNotIn('value: "CP",', after)

    def test_second_run_is_ok_not_applied(self) -> None:
        self.seed()
        self.run_tool(correction(
            "EB01-043", "fragment-all", "effects", 'value: "CP",', self.ENUM))
        settled = self.read("EB01/043-spandine.ts")

        code, text = self.run_tool(correction(
            "EB01-043", "fragment-all", "effects", 'value: "CP",', self.ENUM))

        self.assertEqual(code, 0)
        self.assertIn("already-correct 1", text)
        self.assertIn("applied 0", text)
        self.assertEqual(self.read("EB01/043-spandine.ts"), settled)

    def test_a_half_applied_block_completes_instead_of_drifting(self) -> None:
        self.seed()
        half = self.read("EB01/043-spandine.ts").replace('value: "CP",', self.ENUM, 1)
        self.write("EB01/043-spandine.ts", half)

        code, _ = self.run_tool(correction(
            "EB01-043", "fragment-all", "effects", 'value: "CP",', self.ENUM))

        after = self.read("EB01/043-spandine.ts")
        self.assertEqual(code, 0)
        self.assertEqual(after.count(self.ENUM), 2)

    def test_absent_fragment_is_drift(self) -> None:
        self.seed()
        before = self.read("EB01/043-spandine.ts")

        code, text = self.run_tool(correction(
            "EB01-043", "fragment-all", "effects", 'value: "CP9",', self.ENUM))

        self.assertIn("DRIFT", text)
        self.assertEqual(code, 1)
        self.assertEqual(self.read("EB01/043-spandine.ts"), before)


if __name__ == "__main__":
    unittest.main()
