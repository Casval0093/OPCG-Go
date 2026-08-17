import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02Thatch007,
  op06Genbo105,
  op12Wyper114,
  op15MonkeyDLuffy098,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Fixtures, all vanilla engine cards. Each south-side body isolates one filter:
//   op12Wyper114    Sky Island,        7000 base -- the protected shape
//   op06Genbo105    Sky Island,        5000 base -- right trait, under the threshold
//   op02Kingdew006  Whitebeard,        7000 base -- over the threshold, wrong trait
//   op02Thatch007   Whitebeard,        8000      -- north's attacker, big enough to K.O. all three
//
// `match: "includes"` is substring matching per trait string (matchesTargetFilter), which is what
// makes "Sky Island" match the older concatenated trait "Sky Island Shandian Warrior" these two
// engine cards carry.

function luffyAttackedBy(defender: PlayerFixture["character"], life = 3) {
  // Attacked during NORTH's turn, so the K.O. is a battle K.O. caused by the opponent -- the exact
  // cause ruling #957 is about. Thatch is given playedOnTurn: 0 so it is not newly played and may
  // attack without [Rush].
  return OnePieceTestEngine.create(
    { leaderCardId: op15MonkeyDLuffy098, character: defender, life },
    { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

describe("OP15-098 Monkey.D.Luffy", () => {
  test("ruling #957: a battle K.O. of a 6000+-base Sky Island Character can be replaced by a Life card", () => {
    // The reason the encoding uses `replacedEvent: "leaveField"` rather than "removeFromField".
    // `findKoReplacement` (effects/replacements.ts) searches only ["ko", "leaveField"] when the cause
    // is a battle, so a "removeFromField" encoding would silently never fire here -- no prompt, the
    // Character just dies -- while still passing any effect-removal test. Switch the replacedEvent and
    // this test goes red.
    const engine = luffyAttackedBy([{ card: op12Wyper114, rested: true }]);
    const wyperId = engine.findCardInZone("south", "character", op12Wyper114);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const lifeBefore = engine.getView("south").players.south.lifeCount;
    const handBefore = engine.getView("south").players.south.hand.length;

    engine.declareAttack(thatchId, wyperId, "north");

    // Thatch 8000 >= Wyper 7000, so absent the replacement this is a K.O.
    engine.resolveDecision("battleKoReplacement", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op12Wyper114)).toBe(wyperId);
    expect(view.players.south.lifeCount).toBe(lifeBefore - 1);
    expect(view.players.south.hand).toHaveLength(handBefore + 1);
  });

  test('declining the replacement lets the Character die -- it is a "may"', () => {
    const engine = luffyAttackedBy([{ card: op12Wyper114, rested: true }]);
    const wyperId = engine.findCardInZone("south", "character", op12Wyper114);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const lifeBefore = engine.getView("south").players.south.lifeCount;

    engine.declareAttack(thatchId, wyperId, "north");
    engine.resolveDecision("battleKoReplacement", { optionId: "no" }, "south");

    expect(engine.findCardInZone("south", "trash", op12Wyper114)).toBe(wyperId);
    expect(engine.getView("south").players.south.lifeCount).toBe(lifeBefore);
  });

  test("a 5000-base Sky Island Character is below the threshold and is not offered the replacement", () => {
    const engine = luffyAttackedBy([{ card: op06Genbo105, rested: true }]);
    const genboId = engine.findCardInZone("south", "character", op06Genbo105);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, genboId, "north");

    // No prompt at all, not an empty one: relax the threshold to `gte 5000` and this goes red.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "trash", op06Genbo105)).toBe(genboId);
  });

  test("a 7000-base Character without the [Sky Island] type is not offered the replacement", () => {
    const engine = luffyAttackedBy([{ card: op02Kingdew006, rested: true }]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, kingdewId, "north");

    // Drop the trait filter and this goes red; the threshold test above would not notice.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "trash", op02Kingdew006)).toBe(kingdewId);
  });

  test("ruling #933: at 0 Life cards the replacement is not available", () => {
    // Enforced structurally rather than by a condition on the effect:
    // `replacementActionIsAvailable` rejects a `removeFromLife` of 1 when `life.length` is 0, so the
    // candidate is filtered out before any prompt is built. This test is what stops that being an
    // untested assumption -- and is why the encoding carries no redundant `lifeCount` condition,
    // which would have been an unkillable mutant.
    const engine = luffyAttackedBy([{ card: op12Wyper114, rested: true }], 0);
    const wyperId = engine.findCardInZone("south", "character", op12Wyper114);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, wyperId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "trash", op12Wyper114)).toBe(wyperId);
  });
});
