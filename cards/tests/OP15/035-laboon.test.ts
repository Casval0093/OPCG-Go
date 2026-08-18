import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Smoker093,
  op02Thatch007,
  op05Enel098,
  op15Laboon035,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// The removal has to be an EFFECT and it has to be the OPPONENT's: the printed cause is 因对方的
// 效果, which is `removeFromField` + `source: "opponentEffect"` rather than OP15-098's
// cause-agnostic `leaveField`. Same technique as OP15-105 Bonney's test and OP16-014 Marco's.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-035-RETURN",
  canonicalId: "TEST-OP15-035-RETURN",
  name: "Test Laboon Returner",
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

// op02Kingdew006  7000 base -- exactly on the printed line
// op02Thatch007   8000 base -- one clear of it
// op15Laboon035   2000 base -- its own body, which ruling #890 says it may save
function laboonProtecting(extra: PlayerFixture["character"], activeDon = 0) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op05Enel098,
      character: [{ card: op15Laboon035 }, ...(extra ?? [])],
      activeDon,
    },
    { leaderCardId: op02Smoker093, hand: [returnCharacter] },
    NORTH_ACTS,
  );
}

function restedCount(engine: OnePieceTestEngine) {
  const state = engine.getState();
  return [
    state.players.south.leaderInstanceId,
    ...state.players.south.characterArea.filter((entry): entry is string => entry !== null),
  ].filter((instanceId) => state.cards[instanceId]?.rested).length;
}

describe("OP15-035 Laboon", () => {
  test("a 7000-base Character removed by the opponent's effect is saved by resting exactly 2 cards", () => {
    const engine = laboonProtecting([{ card: op02Kingdew006 }]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const laboonId = engine.findCardInZone("south", "character", op15Laboon035);
    expect(restedCount(engine)).toBe(0);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    const step = engine.pendingDecision("effectMixedRestSelection", "south").steps[0];
    expect(step?.kind).toBe("payCost");
    if (step?.kind !== "payCost") throw new Error("Expected a rest payment selection.");
    // "rest 2 of YOUR cards" -- the pool is Leader + Characters + Stage + active DON!!, and it is
    // mandatory, so min and max are both the printed 2. Single-digit amounts are invisible to
    // mutation_check.py; this is the hand pin.
    expect(step.min).toBe(2);
    expect(step.max).toBe(2);

    engine.resolveDecision(
      "effectMixedRestSelection",
      { selectedIds: [engine.leader("south"), laboonId] },
      "south",
    );

    expect(engine.getState().cards[kingdewId]?.zone).toBe("character");
    expect(restedCount(engine)).toBe(2);
  });

  test('declining lets the Character go -- it is a "may"', () => {
    const engine = laboonProtecting([{ card: op02Kingdew006 }]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
    expect(restedCount(engine)).toBe(0);
  });

  test("an 8000-base Character is over the line and is never offered the replacement", () => {
    const engine = laboonProtecting([{ card: op02Thatch007 }]);
    const thatchId = engine.findCardInZone("south", "character", op02Thatch007);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [thatchId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[thatchId]?.zone).toBe("hand");
  });

  test("ruling #890: this Character may replace its OWN removal", () => {
    // 可以. `findRemovalReplacement` searches the removed instance itself before any other own
    // card, and at 2000 base power Laboon passes its own filter -- which is why the target carries
    // no `excludeSelf`.
    const engine = laboonProtecting([{ card: op02Kingdew006 }]);
    const laboonId = engine.findCardInZone("south", "character", op15Laboon035);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [laboonId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectMixedRestSelection",
      { selectedIds: [engine.leader("south"), kingdewId] },
      "south",
    );

    expect(engine.getState().cards[laboonId]?.zone).toBe("character");
    expect(restedCount(engine)).toBe(2);
  });

  test("fewer than 2 restable cards suppresses the replacement entirely", () => {
    // The structural pin on `amount: 2`. `replacementActionIsAvailable` counts the restable pool
    // before offering anything, so with only the Leader active nothing is published and the
    // Character simply leaves. At `amount: 1` this goes red immediately.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [
          { card: op15Laboon035, rested: true },
          { card: op02Kingdew006, rested: true },
        ],
        activeDon: 0,
      },
      { leaderCardId: op02Smoker093, hand: [returnCharacter] },
      NORTH_ACTS,
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("hand");
  });

  test("one more restable card -- a single active DON!! -- and the replacement is back", () => {
    // The paired control for the case above: identical board plus 1 active DON!!, which is the
    // second restable card. Without it, "no prompt" would be indistinguishable from a broken
    // fixture.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [
          { card: op15Laboon035, rested: true },
          { card: op02Kingdew006, rested: true },
        ],
        activeDon: 1,
      },
      { leaderCardId: op02Smoker093, hand: [returnCharacter] },
      NORTH_ACTS,
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectMixedRestSelection",
      { selectedIds: [engine.leader("south"), "active-don:south:0"] },
      "south",
    );

    expect(engine.getState().cards[kingdewId]?.zone).toBe("character");
    expect(engine.getView("south").players.south.activeDon).toBe(0);
    expect(engine.getView("south").players.south.restedDon).toBe(1);
  });

  test("a battle K.O. is NOT replaceable -- the printed cause is the opponent's EFFECT", () => {
    // The line that separates `removeFromField` from `leaveField`. `findKoReplacement` searches
    // only ["ko", "leaveField"] when the cause is a battle, so re-encoding this as `leaveField`
    // makes a prompt appear here and turns this red.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Laboon035 }, { card: op02Kingdew006, rested: true }],
        activeDon: 2,
      },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, kingdewId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kingdewId]?.zone).toBe("trash");
    expect(restedCount(engine)).toBe(0);
  });

  test("your OWN effect removing your own Character is not replaced", () => {
    // `source: "opponentEffect"` requires the effect's controller to differ from the replacement's.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Laboon035 }, { card: op02Kingdew006 }],
        hand: [returnCharacter],
        activeDon: 2,
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
