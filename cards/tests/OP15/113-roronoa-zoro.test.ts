import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op03Namule007, op05Enel098, op15RoronoaZoro113 } from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function zoroOnPlay(hand: PlayerFixture["hand"]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op05Enel098,
      hand,
      life: 2,
      deck: [op03Namule007, op01Sai012, op01Sai012],
      activeDon: 4,
    },
    {},
    SOUTH_ACTS,
  );
}

describe("OP15-113 Roronoa Zoro", () => {
  test("[On Play] trashing a card puts the top deck card on top of Life", () => {
    const engine = zoroOnPlay([op15RoronoaZoro113, op01Sai012, op01Sai012]);
    const deckTopId = engine.getState().players.south.deck[0];

    engine.playCard(op15RoronoaZoro113, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected a cost payment step.");
    // Unfiltered: "1 card from your hand", any card.
    expect(payment.candidates).toHaveLength(2);
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [payment.candidates[0]?.ref.id ?? ""] },
      "south",
    );

    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "1" }, "south");

    const state = engine.getState();
    expect(state.players.south.life).toHaveLength(3);
    expect(state.players.south.life[0]).toBe(deckTopId);
    expect(state.players.south.deck).toHaveLength(2);
    expect(state.players.south.trash).toHaveLength(1);
  });

  test("ruling #941: with an empty hand the effect is never offered", () => {
    // 不可以. Zoro is the only card in hand, so playing it empties the hand and `canPayCosts`
    // suppresses the confirm before it is created -- no condition needed on the block.
    const engine = zoroOnPlay([op15RoronoaZoro113]);

    engine.playCard(op15RoronoaZoro113, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.life).toHaveLength(2);
    expect(engine.getState().players.south.deck).toHaveLength(3);
  });

  test('"up to 1" allows 0 -- the cost is still spent', () => {
    const engine = zoroOnPlay([op15RoronoaZoro113, op01Sai012, op01Sai012]);

    engine.playCard(op15RoronoaZoro113, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectCostTrashFromHand",
      {
        selectedIds: [engine.getState().players.south.hand[0] ?? ""],
      },
      "south",
    );
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "0" }, "south");

    expect(engine.getState().players.south.life).toHaveLength(2);
    expect(engine.getState().players.south.deck).toHaveLength(3);
    expect(engine.getState().players.south.trash).toHaveLength(1);
  });

  test("declining costs nothing and does nothing", () => {
    const engine = zoroOnPlay([op15RoronoaZoro113, op01Sai012, op01Sai012]);

    engine.playCard(op15RoronoaZoro113, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().players.south.life).toHaveLength(2);
    expect(engine.getState().players.south.trash).toHaveLength(0);
    expect(engine.getState().players.south.hand).toHaveLength(2);
  });
});
