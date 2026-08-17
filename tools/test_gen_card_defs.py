#!/usr/bin/env python3
"""Tests for tools/gen_card_defs.py.

    ./.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gen_card_defs import TEXT_OVERRIDES, _apply_text_fixes  # noqa: E402


class TestTextOverridesAreASafetyNet(unittest.TestCase):
    """The TEXT_OVERRIDES table guards against the importer's `[Trigger]`
    split defect. Once the importer stopped producing that defect the table
    should sit idle: still correcting bad input, but silent on good input, so
    the "data fixes applied" report only lists fixes that were actually needed.
    """

    def test_correct_input_is_left_alone_and_reported_as_no_fix(self):
        override = TEXT_OVERRIDES["OP16-115"]
        raw = {
            "id": "OP16-115",
            "name": "Black Vortex",
            "effect": override["effect"],
            "trigger": override["trigger"],
        }
        warnings: list[str] = []

        fixed = _apply_text_fixes(raw, warnings)

        self.assertEqual(fixed["effect"], override["effect"])
        self.assertEqual(fixed["trigger"], override["trigger"])
        self.assertEqual(warnings, [])

    def test_mis_split_input_is_still_repaired_and_reported(self):
        # Exactly what the importer emitted before the split was fixed.
        raw = {
            "id": "OP16-115",
            "name": "Black Vortex",
            "effect": (
                "[Main] If your Leader has the [Blackbeard Pirates] type, add "
                "up to 1 card with a"
            ),
            "trigger": (
                "other than [Black Vortex] from your trash to your hand. "
                "[Trigger] Negate the effect of up to 1 of your opponent's "
                "Leader or Character cards during this turn."
            ),
        }
        warnings: list[str] = []

        fixed = _apply_text_fixes(raw, warnings)

        self.assertEqual(fixed["effect"], TEXT_OVERRIDES["OP16-115"]["effect"])
        self.assertEqual(fixed["trigger"], TEXT_OVERRIDES["OP16-115"]["trigger"])
        self.assertEqual(len(warnings), 1)
        self.assertIn("OP16-115", warnings[0])

    def test_blank_effect_marker_is_still_emptied(self):
        raw = {"id": "OP15-103", "name": "Genbo", "effect": "-", "trigger": "Draw 1 card."}
        warnings: list[str] = []

        fixed = _apply_text_fixes(raw, warnings)

        self.assertEqual(fixed["effect"], "")
        self.assertEqual(fixed["trigger"], "Draw 1 card.")
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
