import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02LandOfWano048,
  op03Genzo046,
  op04ColorsTrap074,
  op04Spiderweb035,
  op15Lucy002,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [When Attacking]/[On Your Opponent's Attack] half of this Leader is encoded; the
// [Activate: Main] draw is parked for want of a "you activated an Event this turn" condition (see
// cards/OP15/leaders/002-lucy.ts). Nothing here should be read as covering that clause.
//
// The +1000-per-card boost is `thisBattle`, so it is NOT asserted by reading a power number: a
// thisBattle modifier is created and expired inside the same call that resolves the last prompt, so
// by the time control returns to the test `state.modifiers` is empty and the projected power reads
// unmodified even when the action fired correctly (see cards/ENCODING.md, OP16-057 gotcha). Every
// test below makes the boost observable through a durable battle outcome instead.
//
// Fixtures: op04Spiderweb035 + op04ColorsTrap074 (Events), op02LandOfWano048 (Stage),
// op03Genzo046 (Character -- the card that must NOT be trashable), op02Kingdew006 (vanilla 7000).
const SOUTH_HAND = [op04Spiderweb035, op04ColorsTrap074, op02LandOfWano048, op03Genzo046];

function lucyAttacking(hand = SOUTH_HAND) {
  // firstPlayer: "north" makes south the second player; the player going first may not attack on
  // their own first turn, so a south-leader attack is only legal in this seating.
  return OnePieceTestEngine.create(
    { leaderCardId: op15Lucy002, hand },
    { character: [{ card: op02Kingdew006, rested: true }] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-002 Lucy", () => {
  test("[When Attacking] trashing 2 Event/Stage cards wins a battle that 5000 power alone loses", () => {
    const engine = lucyAttacking();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);
    const spiderwebId = engine.findCardInZone("south", "hand", op04Spiderweb035);
    const stageId = engine.findCardInZone("south", "hand", op02LandOfWano048);

    engine.declareAttack(engine.leader("south"), kingdewId, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Lucy's hand-trash choice.");
    // "any number of" -> min 0, max = every eligible card.
    expect(trash).toMatchObject({ min: 0, max: 3 });
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [spiderwebId, stageId] },
      "south",
    );

    // Lucy 5000 + 2x1000 = 7000 vs Kingdew 7000. `attackPower >= defensePower` is a K.O., so the
    // Character is gone -- and it is gone *because of the two cards*, which the next test pins.
    expect(engine.findCardInZone("north", "trash", op02Kingdew006)).toBe(kingdewId);
    expect(engine.getView("north").players.north.characters.filter(Boolean)).toHaveLength(0);
  });

  test("[When Attacking] trashing nothing loses the same battle -- the boost is driven by the count", () => {
    const engine = lucyAttacking();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(engine.leader("south"), kingdewId, "south");
    // min is 0, so declining is a legal resolution of the same prompt rather than a separate
    // "no" option. 5000 vs 7000 -> no K.O.
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [] }, "south");

    expect(engine.getView("north").players.north.characters.filter(Boolean)).toHaveLength(1);
    expect(engine.getState().players.north.trash).toHaveLength(0);
  });

  test("only Event and Stage cards are trashable -- a Character in hand is not a candidate", () => {
    const engine = lucyAttacking();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);
    const genzoId = engine.findCardInZone("south", "hand", op03Genzo046);
    const eligibleIds = [op04Spiderweb035, op04ColorsTrap074, op02LandOfWano048].map((card) =>
      engine.findCardInZone("south", "hand", card),
    );

    engine.declareAttack(engine.leader("south"), kingdewId, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Lucy's hand-trash choice.");
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toEqual(eligibleIds);
    expect(trash.candidates.map((candidate) => candidate.ref.id)).not.toContain(genzoId);
  });

  test("[On Your Opponent's Attack] the Leader's boost prevents Life damage", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Lucy002, hand: SOUTH_HAND },
      {},
      { firstPlayer: "south", activeSeat: "north" },
    );
    const spiderwebId = engine.findCardInZone("south", "hand", op04Spiderweb035);
    const lifeBefore = engine.getView("south").players.south.lifeCount;

    engine.declareAttack(engine.leader("north"), engine.leader("south"), "north");

    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [spiderwebId] }, "south");

    // Both Leaders are 5000 base. Unboosted this is 5000 >= 5000 and Lucy takes a Life; one trashed
    // Event puts her to 6000, so the attack no longer connects.
    expect(engine.getView("south").players.south.lifeCount).toBe(lifeBefore);
  });

  test("[On Your Opponent's Attack] fires when the opponent attacks a CHARACTER, not only the Leader", () => {
    // The decisive test for having left `eventFilter: { targetSelf: true }` off this trigger.
    // OP03-001 Ace, whose action shape this copies, carries targetSelf because its printed wording is
    // "When this Leader ... is attacked"; Lucy prints the unrestricted modern keyword, and
    // `enqueueInPlayEffectsForTrigger(state, "onOpponentAttack", ...)` in battle.ts fires for the
    // defending seat on ANY declared attack. Add targetSelf back and this test goes red -- no prompt
    // is published at all and `pendingDecision` throws.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Lucy002,
        hand: SOUTH_HAND,
        character: [{ card: op03Genzo046, rested: true }],
      },
      {},
      { firstPlayer: "south", activeSeat: "north" },
    );
    const genzoOnFieldId = engine.findCardInZone("south", "character", op03Genzo046);

    engine.declareAttack(engine.leader("north"), genzoOnFieldId, "north");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Lucy's hand-trash choice.");
    expect(trash).toMatchObject({ min: 0, max: 3 });
  });
});
