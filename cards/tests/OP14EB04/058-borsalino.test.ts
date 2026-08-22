import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op02Kingdew006, op14eb04Borsalino058 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function playBorsalino(life: number) {
  return OnePieceTestEngine.create({
    hand: [op14eb04Borsalino058],
    life,
    deck: [op01Sai012, op01Sai012],
    activeDon: 5,
  });
}

describe("EB04-058 Borsalino", () => {
  test("[On Play] at exactly 2 Life puts the top deck card on top of Life", () => {
    // `value: 2` is a single digit -- mutation_check.py generates no numeric mutant for it, so
    // the boundary is pinned by this case (2 fires) and the next (3 does not).
    const engine = playBorsalino(2);
    const deckTopId = engine.getState().players.south.deck[0];

    engine.playCard(op14eb04Borsalino058, "south");
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "1" }, "south");

    const state = engine.getState();
    expect(state.players.south.life).toHaveLength(3);
    expect(state.players.south.life[0]).toBe(deckTopId);
    expect(state.players.south.deck).toHaveLength(1);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("at 3 Life the On Play is silent -- `lte 2`, not a missing condition and not `gte`", () => {
    // Delete the lifeCount condition, or flip it to `gte`, and this opens the add-to-life prompt.
    const engine = playBorsalino(3);

    engine.playCard(op14eb04Borsalino058, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.life).toHaveLength(3);
    expect(engine.getState().players.south.deck).toHaveLength(2);
  });

  test('"up to 1" really allows 0', () => {
    const engine = playBorsalino(2);

    engine.playCard(op14eb04Borsalino058, "south");
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "0" }, "south");

    expect(engine.getState().players.south.life).toHaveLength(2);
    expect(engine.getState().players.south.deck).toHaveLength(2);
  });

  test("[Blocker] is a real printed keyword, not decoration", () => {
    const engine = OnePieceTestEngine.create(
      { character: [op14eb04Borsalino058] },
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const borsalinoId = engine.findCardInZone("south", "character", op14eb04Borsalino058);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    // Without `keywords: ["blocker"]` there is no such prompt and pendingDecision throws.
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Borsalino's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(borsalinoId);

    engine.resolveDecision("battleBlocker", { selectedIds: [borsalinoId] }, "south");
    expect(engine.getState().cards[borsalinoId]?.rested).toBe(true);
  });
});
