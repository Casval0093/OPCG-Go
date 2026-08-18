import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Sai012,
  op02Atmos003,
  op02Kingdew006,
  op03Namule007,
  op15Satori066,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// south is second, so it may attack on its own first turn.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function satoriAttacking(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [{ card: op15Satori066, playedOnTurn: 0 }],
      // Five distinguishable deck cards: the two looked at plus three the effect never sees, so
      // "the remainder landed behind what was never looked at" is assertable.
      deck: [eb01Doma005, op01Sai012, op03Namule007, op02Atmos003, op02Kingdew006],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    { leaderCardId: op16PortgasDAce001 },
    SOUTH_ATTACKS,
  );
  engine.declareAttack(
    engine.findCardInZone("south", "character", op15Satori066),
    engine.leader("north"),
    "south",
  );
  return engine;
}

describe("OP15-066 Satori", () => {
  test("[On Play] DON!! -1: paying returns a DON!! to the DON!! deck and draws exactly 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Satori066],
        deck: [op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const topId = engine.getState().players.south.deck[0];

    engine.playCard(op15Satori066, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 9 });
    expect(state.players.south.hand).toEqual([topId]);
  });

  test("[On Play] declining keeps the DON!! and draws nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Satori066],
        deck: [op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );

    engine.playCard(op15Satori066, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 1, restedDon: 1, donDeckCount: 8 });
    expect(state.players.south.hand).toHaveLength(0);
  });

  test("ruling #906: exactly 2 cards are looked at, and they go to the bottom TOGETHER", () => {
    const engine = satoriAttacking(6);
    const deckBefore = [...engine.getState().players.south.deck];

    const order = engine.pendingDecision("effectRearrangeDeckOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected Satori's two-card order.");
    // Pins `count: 2`. The mutation tool never perturbs an action's `count`, so an off-by-one
    // there is invisible to it.
    expect(order.candidates.map((candidate) => candidate.ref.id)).toEqual(deckBefore.slice(0, 2));

    const chosenOrder = deckBefore.slice(0, 2).reverse();
    engine.resolveDecision("effectRearrangeDeckOrder", { selectedIds: chosenOrder }, "south");

    const position = engine.pendingDecision("effectRearrangeDeckPosition", "south").steps[0];
    if (position?.kind !== "chooseOption") throw new Error("Expected Satori's deck position.");
    // 不可以 -- one card to the top and the other to the bottom is not allowed. There is exactly
    // ONE placement question for the whole group, which is what `position: "topOrBottom"` buys;
    // a per-card destination would have to appear here as two prompts or a richer option set.
    expect(position.options.map((option) => option.id)).toEqual(["top", "bottom"]);
    engine.resolveDecision("effectRearrangeDeckPosition", { optionId: "bottom" }, "south");

    // Assert the WHOLE deck: the pair lands behind the three cards the effect never looked at.
    expect(engine.getState().players.south.deck).toEqual([...deckBefore.slice(2), ...chosenOrder]);
  });

  test('[When Attacking] the "top" branch keeps the chosen order at the front', () => {
    const engine = satoriAttacking(6);
    const deckBefore = [...engine.getState().players.south.deck];
    const chosenOrder = deckBefore.slice(0, 2).reverse();

    engine.resolveDecision("effectRearrangeDeckOrder", { selectedIds: chosenOrder }, "south");
    engine.resolveDecision("effectRearrangeDeckPosition", { optionId: "top" }, "south");

    expect(engine.getState().players.south.deck).toEqual([...chosenOrder, ...deckBefore.slice(2)]);
  });

  test("[When Attacking] well under the threshold: 3 DON!! still fires", () => {
    const engine = satoriAttacking(3);
    const deckBefore = [...engine.getState().players.south.deck];

    const order = engine.pendingDecision("effectRearrangeDeckOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected Satori's two-card order.");
    expect(order.candidates.map((candidate) => candidate.ref.id)).toEqual(deckBefore.slice(0, 2));
  });

  test("[When Attacking] at 7 DON!! the effect never fires", () => {
    const engine = satoriAttacking(7);
    const deckBefore = [...engine.getState().players.south.deck];

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectRearrangeDeckOrder",
        ),
    ).toBe(false);
    expect(engine.getState().players.south.deck).toEqual(deckBefore);
  });
});
