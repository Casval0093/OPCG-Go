import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op01Sai012,
  op02Atmos003,
  op02Kingdew006,
  op03Namule007,
  op11XDrake017,
  op15Enel118,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// See cards/tests/OP15/060-enel.test.ts for the same technique on the other Enel printing.
const bouncer: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-118-BOUNCER",
  canonicalId: "TEST-OP15-118-BOUNCER",
  name: "Test Enel SEC Bouncer",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
          },
        ],
      },
    ],
  },
};

registerCards([bouncer]);

function enelOnField(activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [op15Enel118, op03Namule007],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    { leaderCardId: op16PortgasDAce001, hand: [bouncer] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === instanceId)?.power;
}

describe("OP15-118 Enel", () => {
  test("at 6 DON!!: base 8000 reads exactly 10000 and an opponent's effect cannot remove him", () => {
    const engine = enelOnField(6);
    const enelId = engine.findCardInZone("south", "character", op15Enel118);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    expect(powerOf(engine, enelId)).toBe(10000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([namuleId]);
  });

  test("well below the threshold too: 3 DON!! still buys the +2000 and the protection", () => {
    // At exactly 6 both `lte 6` and `gte 6` hold, so the boundary fixture alone leaves the
    // comparison mutant alive.
    const engine = enelOnField(3);
    const enelId = engine.findCardInZone("south", "character", op15Enel118);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    expect(powerOf(engine, enelId)).toBe(10000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([namuleId]);
  });

  test("at 7 DON!! neither half applies: 8000 power and bounceable", () => {
    const engine = enelOnField(7);
    const enelId = engine.findCardInZone("south", "character", op15Enel118);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    expect(powerOf(engine, enelId)).toBe(8000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([enelId, namuleId]);
  });

  test("[On Play] DON!! -1: look at 5, take 1, rest to the bottom, then trash 1 from hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Enel118],
        // Seven cards: five looked at plus two the search never sees, so "the remainder lands
        // BEHIND what was never looked at" is assertable rather than assumed.
        deck: [
          eb01Doma005,
          op01Sai012,
          op03Namule007,
          op02Atmos003,
          op02Kingdew006,
          op11XDrake017,
          eb01Doma005,
        ],
        activeDon: op15Enel118.cost + 1,
        donDeckCount: 3,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op15Enel118, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    // Playing Enel rested 6 DON!!, so the payer now holds two KINDS of DON!! and `returnDon`
    // publishes a real payment choice instead of auto-paying.
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Enel's look-at-5.");
    // Exactly the top 5, all legal: "add up to 1 card" carries no restriction.
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual(deckBefore.slice(0, 5));
    const kept = deckBefore[1] as string;
    engine.resolveDecision("effectSearchSelection", { selectedIds: [kept] }, "south");

    const remainder = [deckBefore[4], deckBefore[3], deckBefore[2], deckBefore[0]] as string[];
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: remainder }, "south");

    // The hand now holds the kept card and nothing else, so `trashFromHand` auto-resolves on it
    // -- there is no choice to make when the eligible pool is exactly the requested amount.
    const state = engine.getState();
    expect(state.players.south.hand).toHaveLength(0);
    expect(state.players.south.trash).toEqual([kept]);
    expect(state.players.south.deck).toEqual([...deckBefore.slice(5), ...remainder]);
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 6, donDeckCount: 4 });
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test('[On Play] "up to 1" may be declined and all 5 go to the bottom', () => {
    // The only case that pins `revealCount.upTo`: taking exactly one card is legal with or
    // without it, so a test that always keeps a card leaves the flag unprobed.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Enel118],
        deck: [
          eb01Doma005,
          op01Sai012,
          op03Namule007,
          op02Atmos003,
          op02Kingdew006,
          op11XDrake017,
          eb01Doma005,
        ],
        activeDon: op15Enel118.cost + 1,
        donDeckCount: 3,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op15Enel118, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");

    const remainder = deckBefore.slice(0, 5).reverse();
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: remainder }, "south");

    const state = engine.getState();
    // Nothing was added, so the "trash 1 card from your hand" half has nothing to trash and
    // does not stall.
    expect(state.players.south.hand).toHaveLength(0);
    expect(state.players.south.trash).toHaveLength(0);
    expect(state.players.south.deck).toEqual([...deckBefore.slice(5), ...remainder]);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[On Play] declining the DON!! -1 skips the whole block", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Enel118],
        deck: [eb01Doma005, op01Sai012, op03Namule007, op02Atmos003, op02Kingdew006],
        activeDon: op15Enel118.cost + 1,
        donDeckCount: 3,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op15Enel118, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south.deck).toEqual(deckBefore);
    expect(state.players.south.hand).toHaveLength(0);
    expect(state.players.south).toMatchObject({ activeDon: 1, restedDon: 6, donDeckCount: 3 });
  });
});
