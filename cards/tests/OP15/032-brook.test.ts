import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op02Smoker093,
  op03Namule007,
  op05Enel098,
  op05JohnGiant044,
  op06TheArkMaxim117,
  op08TonyTonyChopper001,
  op15Brook032,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The vanilla pool tops out at cost 8, so "a base cost of 8 or less" needs a synthetic body over
// the line. This one is also the `baseCost`-vs-`cost` discriminator the mutation checker can never
// build for itself: printed cost 9, permanently discounted to 7 by its own self-targeting
// modifyCost, so it is INELIGIBLE under the printed `baseCost lte 8` and would be ELIGIBLE under a
// plain `cost lte 8`. (`getPermanentModifierTotal` drops any permanent modifier that is neither
// `self` nor `count.amount: "all"`, hence the `self: true`.)
const discountedGiant: CharacterCard = {
  ...op05JohnGiant044,
  id: "TEST-OP15-032-BASE-COST-9",
  canonicalId: "TEST-OP15-032-BASE-COST-9",
  name: "Test Discounted Giant",
  i18n: { en: { ...op05JohnGiant044.i18n.en, name: "Test Discounted Giant" } },
  cost: 9,
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: -2,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([discountedGiant]);

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

// op08TonyTonyChopper001's traits are ONE concatenated string, "Animal Drum Kingdom Straw Hat
// Crew", so `match: "includes"` is genuinely exercised; its only ability is an [Activate: Main],
// so it is otherwise inert.
function brookActivating(leaderCardId: typeof op08TonyTonyChopper001) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [
        { card: op15Brook032 },
        { card: op05JohnGiant044, rested: true },
        { card: discountedGiant, rested: true },
        { card: op03Namule007, rested: true },
      ],
      activeDon: 6,
    },
    { leaderCardId: op02Smoker093 },
    SOUTH_ACTS,
  );
}

describe("OP15-032 Brook", () => {
  test("[On Play] rests any one of the opponent's cards -- Leader, Character, Stage or DON!!", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15Brook032], activeDon: 6 },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Atmos003 }, { card: op03Namule007, rested: true }],
        stage: op06TheArkMaxim117,
        activeDon: 2,
        restedDon: 1,
      },
      SOUTH_ACTS,
    );
    const northLeaderId = engine.leader("north");
    const activeBodyId = engine.findCardInZone("north", "character", op02Atmos003);
    const restedBodyId = engine.findCardInZone("north", "character", op03Namule007);
    const stageId = engine.findCardInZone("north", "stage", op06TheArkMaxim117);

    engine.playCard(op15Brook032, "south");

    // A rest target spanning field zones AND costArea publishes `effectMixedRestSelection`, and its
    // step kind is payCost rather than selectEntity.
    const step = engine.pendingDecision("effectMixedRestSelection", "south").steps[0];
    expect(step?.kind).toBe("payCost");
    if (step?.kind !== "payCost") throw new Error("Expected a mixed rest selection.");
    const candidates = step.candidates.map((candidate) => candidate.ref.id);
    expect(candidates.sort()).toEqual(
      [northLeaderId, activeBodyId, stageId, "active-don:north:0", "active-don:north:1"].sort(),
    );
    // Already-rested cards are dropped from the pool upstream; north's rested DON!! is likewise
    // absent because only ACTIVE DON!! can be rested.
    expect(candidates).not.toContain(restedBodyId);
    expect(step.max).toBe(1);

    // Resting a DON!! is the half a `zones: ["leader","character","stage"]` encoding would lose.
    engine.resolveDecision(
      "effectMixedRestSelection",
      { selectedIds: ["active-don:north:0"] },
      "south",
    );
    const view = engine.getView("south");
    expect(view.players.north.activeDon).toBe(1);
    expect(view.players.north.restedDon).toBe(2);
  });

  test("[Activate: Main] trashes Brook and sets a base-cost-8-or-less Character active", () => {
    const engine = brookActivating(op08TonyTonyChopper001);
    const brookId = engine.findCardInZone("south", "character", op15Brook032);
    const giantId = engine.findCardInZone("south", "character", op05JohnGiant044);
    const discountedId = engine.findCardInZone("south", "character", discountedGiant);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    // The discriminator is only a discriminator if the discount actually applied.
    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === discountedId)?.cost,
    ).toBe(7);

    engine.activateEffect(brookId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getState().cards[brookId]?.zone).toBe("trash");

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(step?.kind).toBe("selectEntity");
    if (step?.kind !== "selectEntity") throw new Error("Expected a setActive target selection.");
    const candidates = step.candidates.map((candidate) => candidate.ref.id);
    // Cost 8 is exactly on the line. The printed-9/current-7 body is out, which is what separates
    // `baseCost` from `cost`; Namule at cost 3 is in, which kills `comparison lte -> gte`.
    expect(candidates.sort()).toEqual([giantId, namuleId].sort());
    expect(candidates).not.toContain(discountedId);
    expect(step.max).toBe(1);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [giantId] }, "south");
    expect(engine.getState().cards[giantId]?.rested).toBe(false);
    expect(engine.getState().cards[namuleId]?.rested).toBe(true);
  });

  test("the Leader check sits AFTER the colon: the cost is paid and buys nothing", () => {
    // op05Enel098 is [Sky Island]. The activation is still legal and Brook is still trashed --
    // moving this check into the block's `conditions` would instead make the whole activation
    // illegal, which is the wrong card.
    const engine = brookActivating(op05Enel098);
    const brookId = engine.findCardInZone("south", "character", op15Brook032);
    const giantId = engine.findCardInZone("south", "character", op05JohnGiant044);

    engine.activateEffect(brookId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getState().cards[brookId]?.zone).toBe("trash");
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[giantId]?.rested).toBe(true);
  });

  test('"You may trash this Character" is a real choice', () => {
    const engine = brookActivating(op08TonyTonyChopper001);
    const brookId = engine.findCardInZone("south", "character", op15Brook032);
    const giantId = engine.findCardInZone("south", "character", op05JohnGiant044);

    engine.activateEffect(brookId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().cards[brookId]?.zone).toBe("character");
    expect(engine.getState().cards[giantId]?.rested).toBe(true);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
