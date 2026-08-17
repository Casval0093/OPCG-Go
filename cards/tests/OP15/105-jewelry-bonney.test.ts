import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Thatch007,
  op05Enel098,
  op15JewelryBonney105,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A minimal opponent "remove from the field by effect" source, the same technique
// packages/engine/tests/cards/characters/op07-042-gecko-moria.test.ts and OP16-014 Marco's test
// use. It has to be an EFFECT: this card's SC is 因对方的效果 ("because of the opponent's
// effect"), unlike OP15-098 Monkey.D.Luffy's cause-agnostic 因对方.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-105-RETURN",
  canonicalId: "TEST-OP15-105-RETURN",
  name: "Test Bonney Returner",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: { player: "any", zones: ["character"], count: { amount: 1 } },
          },
        ],
      },
    ],
  },
};

registerCards([returnCharacter]);

const NORTH_ACTS = { firstPlayer: "north", activeSeat: "north" } as const;

function bonneyProtecting(extra: PlayerFixture["character"], life = 3) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, character: [op15JewelryBonney105, ...(extra ?? [])], life },
    { hand: [returnCharacter] },
    NORTH_ACTS,
  );
}

describe("OP15-105 Jewelry Bonney", () => {
  test("a 7000-base Character removed by the opponent's effect is saved for 1 Life card", () => {
    const engine = bonneyProtecting([op02Kingdew006]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const lifeBefore = engine.getState().players.south.life.length;
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    const state = engine.getState();
    // 7000 is exactly on the printed line; at `lte 6000` this Character would not be offered.
    expect(state.cards[kingdewId]?.zone).toBe("character");
    expect(state.players.south.life).toHaveLength(lifeBefore - 1);
    expect(state.players.south.hand).toHaveLength(handBefore + 1);
  });

  test('declining lets the Character go -- it is a "may"', () => {
    const engine = bonneyProtecting([op02Kingdew006]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const lifeBefore = engine.getState().players.south.life.length;

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
    expect(engine.getState().players.south.life).toHaveLength(lifeBefore);
  });

  test("an 8000-base Character is over the line and is never offered the replacement", () => {
    const engine = bonneyProtecting([op02Thatch007]);
    const thatchId = engine.findCardInZone("south", "character", op02Thatch007);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [thatchId] }, "north");

    // No prompt at all, not an empty one.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[thatchId]?.zone).toBe("hand");
  });

  test("ruling #939: this Character may replace its OWN removal", () => {
    // 可以. `findRemovalReplacement` searches the removed instance itself before any other own
    // card, and at 2000 base power Bonney passes her own filter -- which is why the target
    // carries no `excludeSelf`.
    const engine = bonneyProtecting([]);
    const bonneyId = engine.findCardInZone("south", "character", op15JewelryBonney105);
    const lifeBefore = engine.getState().players.south.life.length;

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [bonneyId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.getState().cards[bonneyId]?.zone).toBe("character");
    expect(engine.getState().players.south.life).toHaveLength(lifeBefore - 1);
  });

  test("a battle K.O. is NOT replaceable -- the printed cause is the opponent's EFFECT", () => {
    // The line that separates this card from OP15-098 Monkey.D.Luffy. `findKoReplacement` searches
    // only ["ko", "leaveField"] when the cause is a battle, so `removeFromField` correctly never
    // fires here; re-encode it as `leaveField` and this test goes red with a prompt appearing.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15JewelryBonney105, rested: true }],
        life: 3,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      // A NORTH attack needs north not to be the player going first: the first player cannot
      // attack on their own first turn.
      { firstPlayer: "south", activeSeat: "north" },
    );
    const bonneyId = engine.findCardInZone("south", "character", op15JewelryBonney105);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, bonneyId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[bonneyId]?.zone).toBe("trash");
    expect(engine.getState().players.south.life).toHaveLength(3);
  });

  test("at 0 Life cards the replacement is not available", () => {
    // Structural, not a condition: `replacementActionIsAvailable` rejects a `removeFromLife` of 1
    // against an empty Life area, so a `lifeCount` condition would be an unkillable mutant.
    const engine = bonneyProtecting([op02Kingdew006], 0);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
  });

  test("your OWN effect removing your own Character is not replaced", () => {
    // `source: "opponentEffect"` requires the effect's controller to differ from the replacement's
    // controller. Playing the returner on the SOUTH side must therefore offer nothing.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [op15JewelryBonney105, op02Kingdew006],
        hand: [returnCharacter],
        life: 3,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
  });
});
