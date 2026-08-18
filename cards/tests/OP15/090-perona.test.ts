import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Thatch007,
  op06GeckoMoria080,
  op15Perona090,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A minimal opponent "remove from the field by EFFECT" source. It has to be an effect: this
// card's SC is 因对方的效果, so `findRemovalReplacement` gates on `koCause === "effect"`.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-090-RETURN",
  canonicalId: "TEST-OP15-090-RETURN",
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

// A power filter cannot tell `basePower` from `power` on a plain fixture, and mutation_check.py
// has no operator that rewrites one to the other -- so the discriminator has to be built. This
// body prints 6000 (inside the line) and permanently buffs ITSELF to 9000 (outside it). Under
// `basePower` it stays protected; under plain `power` it would not be. `self: true` is required
// or `getPermanentModifierTotal` skips the modifier entirely.
const buffedLowBase: CharacterCard = {
  ...op02Kingdew006,
  id: "TEST-OP15-090-BUFFED",
  canonicalId: "TEST-OP15-090-BUFFED",
  power: 6000,
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 3000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([returnCharacter, buffedLowBase]);

const NORTH_ACTS = { firstPlayer: "north", activeSeat: "north" } as const;

function peronaProtecting(extra: PlayerFixture["character"]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op06GeckoMoria080,
      character: [op15Perona090, ...(extra ?? [])],
      hand: 2,
      deck: 10,
    },
    { hand: [returnCharacter], activeDon: 3 },
    NORTH_ACTS,
  );
}

describe("OP15-090 Perona", () => {
  test("a 7000-base Character is saved for 1 card from hand -- the printed boundary", () => {
    // op02Kingdew006 prints exactly 7000, ON the line. That is what kills
    // `value: 7000 -> 6000`; a body comfortably under the line would not.
    const engine = peronaProtecting([op02Kingdew006]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    // Accepting the replacement opens the payment: 2 cards in hand against an amount of 1, so a
    // real selection prompt appears rather than an auto-payment.
    const payment = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (payment?.kind !== "selectEntity") throw new Error("Expected the hand-trash selection.");
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [payment.candidates[0]!.ref.id] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[kingdewId]?.zone).toBe("character");
    expect(state.players.south.hand).toHaveLength(1);
    expect(state.players.south.trash).toHaveLength(1);
  });

  test("an 8000-base Character is over the line and is never offered", () => {
    // The only case that kills `comparison lte -> gte`: at `gte 7000` an 8000-base body would be
    // protected. It also kills `delete filter:basePower`.
    const engine = peronaProtecting([op02Thatch007]);
    const thatchId = engine.findCardInZone("south", "character", op02Thatch007);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [thatchId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[thatchId]?.zone).toBe("hand");
  });

  test("原本的力量: a 6000-base body buffed to 9000 is still protected", () => {
    const engine = peronaProtecting([buffedLowBase]);
    const buffedId = engine.findCardInZone("south", "character", buffedLowBase);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buffedId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.getState().cards[buffedId]?.zone).toBe("character");
  });

  test("ruling #925: this Character may replace its OWN removal", () => {
    // 可以 -- Perona is 2000 base and passes her own filter, which is why the target carries no
    // `excludeSelf`. This is the exact opposite of OP15-094 Zoro in the same batch.
    const engine = peronaProtecting([]);
    const peronaId = engine.findCardInZone("south", "character", op15Perona090);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [peronaId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.getState().cards[peronaId]?.zone).toBe("character");
  });

  test('declining lets the Character go -- it is a "may"', () => {
    const engine = peronaProtecting([op02Kingdew006]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    const state = engine.getState();
    // The bounced Character joins its OWNER's hand, so south goes 2 -> 3 and nothing was trashed.
    expect(state.cards[kingdewId]?.zone).toBe("hand");
    expect(state.players.south.hand).toHaveLength(3);
    expect(state.players.south.trash).toHaveLength(0);
  });

  test("your OWN effect removing your Character is not replaced either", () => {
    // 因**对方**的效果. `source: "opponentEffect"` carries this half, and it is the field doing the
    // cause gating too: `findRemovalReplacement` accepts `opponentEffect` only when
    // `koCause === "effect"` AND the effect controller is the other seat. Drop it and this goes
    // red while every other test here stays green.
    //
    // The two spare hand cards are load-bearing and were added after a hand-mutation pass:
    // playing the source empties a one-card hand, `replacementActionIsAvailable` then rejects a
    // `trashFromHand` of 1 outright, and the absent prompt says nothing at all about the source
    // gate. This is the OP15-098 / ruling #933 trap in fixture form.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        character: [op15Perona090, op02Kingdew006],
        hand: [returnCharacter, op02Thatch007, op02Thatch007],
        deck: 10,
        activeDon: 3,
      },
      {},
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
  });

  test("a battle K.O. is NOT replaceable -- the printed cause is the opponent's EFFECT", () => {
    // Silent under the wrong choice, so it has to be tested explicitly: `leaveField` would
    // wrongly intercept this, `removeFromField` correctly does not.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        character: [op15Perona090, { card: op02Kingdew006, rested: true }],
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      kingdewId,
      "north",
    );

    expect(engine.getState().cards[kingdewId]?.zone).toBe("trash");
  });
});
