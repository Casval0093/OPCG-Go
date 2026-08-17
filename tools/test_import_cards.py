#!/usr/bin/env python3
"""Tests for tools/import_cards.py.

Stdlib unittest, matching the importer's own stdlib-only constraint:

    ./.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v

The card text below is quoted verbatim from `one-piece-card-game-json`'s
`effects` field (the official Bandai list) and fed through the importer's own
`clean_text`, so these exercise the real pipeline rather than a paraphrase of
it. Independently checked against onepiece.limitlesstcg.com/cards/<id>.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from import_cards import clean_text, split_trigger  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, "data")


def split(raw: str) -> tuple[str, str]:
    """Run one upstream `effects` string through the importer's real path."""
    return split_trigger(clean_text(raw))


class TestTriggerKeywordReferenceIsNotAHeading(unittest.TestCase):
    """"[Trigger]" mid-sentence names OTHER cards' Trigger abilities.

    It is not this card's Trigger-box heading, so it must not split the text.
    Cutting there loses the tail of the effect into `trigger`, and where a real
    Trigger box follows, glues the real ability onto that fragment.
    """

    def test_op16_080_teach_leader_has_no_trigger_box_at_all(self):
        # A Leader cannot have a Trigger ability. The only "[Trigger]" here is
        # the cost of the leader's own redirect: trash a Trigger card to
        # change an attack's target.
        effect, trigger = split(
            "[Opponent's Turn] All of your Characters gain +1 cost.<br>"
            "[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card "
            "with a [Trigger] from your hand: Change the target of that attack "
            "to this Leader or to one of your {Blackbeard Pirates} type "
            "Character cards."
        )
        self.assertEqual(
            effect,
            "[Opponent's Turn] All of your Characters gain +1 cost.\n"
            "[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card "
            "with a [Trigger] from your hand: Change the target of that attack "
            "to this Leader or to one of your [Blackbeard Pirates] type "
            "Character cards.",
        )
        self.assertEqual(trigger, "")

    def test_op16_115_black_vortex_splits_at_the_real_heading(self):
        effect, trigger = split(
            "[Main] If your Leader has the {Blackbeard Pirates} type, add up to "
            "1 card with a [Trigger] other than [Black Vortex] from your trash "
            "to your hand. [Trigger] Negate the effect of up to 1 of your "
            "opponent's Leader or Character cards during this turn."
        )
        self.assertEqual(
            effect,
            "[Main] If your Leader has the [Blackbeard Pirates] type, add up to "
            "1 card with a [Trigger] other than [Black Vortex] from your trash "
            "to your hand.",
        )
        self.assertEqual(
            trigger,
            "Negate the effect of up to 1 of your opponent's Leader or "
            "Character cards during this turn.",
        )

    def test_op16_117_black_hole_splits_at_the_real_heading(self):
        effect, trigger = split(
            "[Main] You may trash 1 card with a [Trigger] from your hand: "
            "Negate the effects of up to 1 of your opponent's Characters with a "
            "cost of 8 or less during this turn. [Trigger] Add up to 1 "
            "{Blackbeard Pirates} type card from your trash to your hand."
        )
        self.assertEqual(
            effect,
            "[Main] You may trash 1 card with a [Trigger] from your hand: "
            "Negate the effects of up to 1 of your opponent's Characters with a "
            "cost of 8 or less during this turn.",
        )
        self.assertEqual(
            trigger,
            "Add up to 1 [Blackbeard Pirates] type card from your trash to your "
            "hand.",
        )

    def test_op11_102_keyword_reference_after_or_is_not_a_heading(self):
        # "an Event or [Trigger]" -- the same defect with a different
        # preceding word, on a card outside the Blackbeard deck.
        effect, trigger = split(
            "[Your Turn] [Once Per Turn] This effect can be activated when your "
            "opponent activates an Event or [Trigger]. If your opponent has 2 or "
            "more Life cards, trash 1 card from the top of each of your and your "
            "opponent's Life cards."
        )
        self.assertTrue(effect.endswith("Life cards."), effect)
        self.assertEqual(trigger, "")

    def test_op09_115_heading_immediately_follows_a_keyword_reference(self):
        # "...and a [Trigger]. [Trigger] Draw 1 card." -- adjacent occurrences,
        # the first a reference and the second the heading.
        effect, trigger = split(
            "[Main] K.O. up to 1 of your opponent's Characters with a cost of 3 "
            "or less and a [Trigger]. [Trigger] Draw 1 card."
        )
        self.assertEqual(
            effect,
            "[Main] K.O. up to 1 of your opponent's Characters with a cost of 3 "
            "or less and a [Trigger].",
        )
        self.assertEqual(trigger, "Draw 1 card.")


class TestGenuineTriggerHeadings(unittest.TestCase):
    """Controls: the shapes a real Trigger box actually takes upstream."""

    def test_plain_trigger_box_after_the_main_ability(self):
        effect, trigger = split(
            "[On Play] Draw 2 cards and trash 1 card from your hand. "
            "[Trigger] Play up to 1 Character card with 5000 power or less and "
            "a [Trigger] from your hand."
        )
        # The heading is the FIRST occurrence here and the reference the
        # second, so "split on the last [Trigger]" would be wrong.
        self.assertEqual(
            effect, "[On Play] Draw 2 cards and trash 1 card from your hand."
        )
        self.assertEqual(
            trigger,
            "Play up to 1 Character card with 5000 power or less and a "
            "[Trigger] from your hand.",
        )

    def test_trigger_box_at_the_very_start(self):
        effect, trigger = split("[Trigger] Play this card.")
        self.assertEqual(effect, "")
        self.assertEqual(trigger, "Play this card.")

    def test_blank_main_ability_marker_before_the_trigger_box(self):
        # Upstream writes a card with no main ability as a bare "-".
        effect, trigger = split(
            "- [Trigger] Draw 1 card. Then, if you have 2 or less Life cards, "
            "play this card."
        )
        self.assertEqual(effect, "-")
        self.assertEqual(
            trigger,
            "Draw 1 card. Then, if you have 2 or less Life cards, play this card.",
        )

    def test_trigger_box_after_a_keyword_ability(self):
        # OP14-109: "[Blocker] [Trigger] ..." -- heading preceded by "]".
        effect, trigger = split(
            "[Blocker] [Trigger] Play up to 1 {Thriller Bark Pirates} type "
            "Character card with a cost of 4 or less from your trash rested."
        )
        self.assertEqual(effect, "[Blocker]")
        self.assertEqual(
            trigger,
            "Play up to 1 [Thriller Bark Pirates] type Character card with a "
            "cost of 4 or less from your trash rested.",
        )

    def test_trigger_box_on_its_own_line(self):
        effect, trigger = split(
            "[Main] K.O. up to 1 of your opponent's rested Characters with a "
            "cost of 4 or less.<br> [Trigger] Play up to 1 Character card with "
            "a cost of 4 or less and no base effect from your hand."
        )
        self.assertEqual(
            effect,
            "[Main] K.O. up to 1 of your opponent's rested Characters with a "
            "cost of 4 or less.",
        )
        self.assertEqual(
            trigger,
            "Play up to 1 Character card with a cost of 4 or less and no base "
            "effect from your hand.",
        )

    def test_trigger_box_after_parenthesised_reminder_text(self):
        effect, trigger = split(
            "[DON!! x1] [When Attacking] Your opponent cannot activate "
            "[Blocker] during this battle.<br>(A Character with [Blocker] can "
            "change the target of the attack.) [Trigger] Play this card."
        )
        self.assertTrue(effect.endswith("target of the attack.)"), effect)
        self.assertEqual(trigger, "Play this card.")

    def test_card_with_no_trigger_at_all(self):
        effect, trigger = split(
            "[On Play] Give up to 1 rested DON!! card to your Leader or 1 of "
            "your Characters."
        )
        self.assertEqual(
            effect,
            "[On Play] Give up to 1 rested DON!! card to your Leader or 1 of "
            "your Characters.",
        )
        self.assertEqual(trigger, "")

    def test_empty_effect(self):
        self.assertEqual(split(""), ("", ""))


class TestImportedDataIsNotCutMidSentence(unittest.TestCase):
    """Whole-dataset guard over the JSON the importer actually shipped.

    A `[Trigger]` split in the wrong place leaves `effect` ending on a bare
    word instead of a clause boundary. Assert the boundary directly so a future
    set (OP17) fails here rather than silently shipping a truncated effect.
    """

    TERMINATORS = ".)]-!?:"

    def test_every_imported_effect_ends_on_a_clause_boundary(self):
        offenders = []
        for set_id in ("OP15", "OP16"):
            path = os.path.join(DATA_DIR, f"cards-{set_id}-en.json")
            with open(path, encoding="utf8") as handle:
                for card in json.load(handle):
                    for field in ("effect", "trigger"):
                        text = (card.get(field) or "").strip()
                        if text and text[-1] not in self.TERMINATORS:
                            offenders.append(f"{card['id']} {field}: ...{text[-50:]!r}")
        self.assertEqual(offenders, [], "\n".join(["cut mid-sentence:"] + offenders))


if __name__ == "__main__":
    unittest.main()
