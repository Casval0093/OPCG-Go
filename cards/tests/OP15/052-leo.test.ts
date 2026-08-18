import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Smoker093,
  op02Thatch007,
  op10BlueGilly054,
  op15Leo052,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A minimal opponent "remove from the field by effect" source -- the technique
// tests/cards/characters/op07-042-gecko-moria.test.ts, OP16-014 Marco and OP15-105 Bonney all use.
// It has to be an EFFECT: this card's SC is 因对方的效果, not the cause-agnostic 因对方 of
// OP15-098 Monkey.D.Luffy.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-052-RETURN",
  canonicalId: "TEST-OP15-052-RETURN",
  name: "Test Leo Returner",
  i18n: { en: { ...eb01Doma005.i18n.en, name: "Test Leo Returner" } },
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

// A body whose BASE power is on the protected side of the line while its CURRENT power is not.
// A plain fixture cannot tell `basePower` from `power` -- both readings are green on any board
// where nothing is modified -- and `mutation_check.py` has no operator that rewrites one to the
// other, so this discriminator has to be built by hand. Per the printed 原本的力量, the buff
// direction is the one that must still be protected.
const buffedSevenThousand: CharacterCard = {
  ...op02Kingdew006,
  id: "TEST-OP15-052-BUFFED",
  canonicalId: "TEST-OP15-052-BUFFED",
  name: "Test Buffed Seven Thousand",
  i18n: { en: { ...op02Kingdew006.i18n.en, name: "Test Buffed Seven Thousand" } },
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([returnCharacter, buffedSevenThousand]);

function leoProtecting(extra: PlayerFixture["character"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op02Smoker093, character: [op15Leo052, ...(extra ?? [])] },
    { leaderCardId: op02Smoker093, hand: [returnCharacter] },
    { firstPlayer: "north", activeSeat: "north" },
  );
}

describe("OP15-052 Leo", () => {
  test("a 7000-base Character removed by the opponent's effect is saved by bottoming another", () => {
    const engine = leoProtecting([op02Kingdew006, op10BlueGilly054]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    // "1 of your Characters" -- a free choice among all of them, not a fixed self-sacrifice.
    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Leo's bottom-deck choice.");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");

    const state = engine.getState();
    // 7000 is exactly on the printed line; at `lte 6000` this Character would not be offered.
    expect(state.cards[kingdewId]?.zone).toBe("character");
    expect(state.cards[blueGillyId]?.zone).toBe("deck");
    expect(state.players.south.deck).toHaveLength(deckBefore + 1);
    expect(state.players.south.deck.at(-1)).toBe(blueGillyId);
  });

  test("an 8000-base Character is over the line and is never offered the replacement", () => {
    const engine = leoProtecting([op02Thatch007, op10BlueGilly054]);
    const thatchId = engine.findCardInZone("south", "character", op02Thatch007);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [thatchId] }, "north");

    // No prompt at all, not an empty one.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[thatchId]?.zone).toBe("hand");
  });

  test("the threshold reads BASE power: a 7000-base body buffed to 9000 is still protected", () => {
    const engine = leoProtecting([buffedSevenThousand, op10BlueGilly054]);
    const buffedId = engine.findCardInZone("south", "character", buffedSevenThousand);
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    // Sanity-check the discriminator itself: current power really is over the line.
    expect(
      engine.getView("south").players.south.characters.find((card) => card?.instanceId === buffedId)
        ?.power,
    ).toBe(9000);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buffedId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");

    // Under a `power lte 7000` reading there would have been no prompt at all.
    expect(engine.getState().cards[buffedId]?.zone).toBe("character");
  });

  test("ruling #897: Leo may save ITSELF by bottoming another of your Characters", () => {
    // 可以. `findRemovalReplacement` searches the removed instance itself before any other own
    // card, and at 2000 base power Leo passes its own filter -- which is why the target carries no
    // `excludeSelf`. The replacement action is a separate free choice, which is what lets a
    // DIFFERENT Character pay for Leo's survival.
    const engine = leoProtecting([op10BlueGilly054]);
    const leoId = engine.findCardInZone("south", "character", op15Leo052);
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [leoId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");

    const state = engine.getState();
    expect(state.cards[leoId]?.zone).toBe("character");
    expect(state.players.south.deck.at(-1)).toBe(blueGillyId);
  });

  test('declining lets the Character go -- it is a "may"', () => {
    const engine = leoProtecting([op02Kingdew006, op10BlueGilly054]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.cards[kingdewId]?.zone).toBe("hand");
    expect(state.players.south.deck).toHaveLength(deckBefore);
  });

  test("a battle K.O. is NOT replaceable -- the printed cause is the opponent's EFFECT", () => {
    // The line that separates this card from OP15-098 Monkey.D.Luffy. `findKoReplacement` searches
    // only ["ko", "leaveField"] when the cause is a battle, so `removeFromField` correctly never
    // fires here; re-encode it as `leaveField` and this test goes red with a prompt appearing.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op15Leo052, rested: true }, op10BlueGilly054],
      },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const leoId = engine.findCardInZone("south", "character", op15Leo052);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, leoId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[leoId]?.zone).toBe("trash");
  });

  test("your OWN effect removing your own Character is not replaced", () => {
    // `source: "opponentEffect"` requires the effect's controller to differ from the replacement's
    // controller, so playing the returner on the SOUTH side must offer nothing.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [op15Leo052, op02Kingdew006, op10BlueGilly054],
        hand: [returnCharacter],
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
  });
});
