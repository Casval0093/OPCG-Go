import { describe, expect, test } from "vite-plus/test";
import {
  op01Bellamy076,
  op02Seaquake021,
  op02Smoker093,
  op02Thatch007,
  op04Barrier095,
  op10BlueGilly054,
  op15Sai045,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP15-045 Sai", () => {
  test("[On Play] trashes 1 Event -- and only an Event -- to draw 2", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        // TWO Events on purpose: a cost with exactly one eligible candidate auto-pays and
        // publishes no prompt at all, so the filter would be unobservable with one.
        hand: [op15Sai045, op02Seaquake021, op04Barrier095, op01Bellamy076],
        activeDon: 5,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const seaquakeId = engine.findCardInZone("south", "hand", op02Seaquake021);
    const barrierId = engine.findCardInZone("south", "hand", op04Barrier095);
    const characterId = engine.findCardInZone("south", "hand", op01Bellamy076);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Sai045, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Sai's Event-trash cost.");
    // A `trashFromHand` COST scans the whole hand with no card-type pre-filter, so a Character is
    // a genuine false positive and `cardCategory: "event"` is what removes it.
    expect(cost.candidates.map((candidate) => candidate.ref.id)).toEqual([seaquakeId, barrierId]);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(characterId);

    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [seaquakeId] }, "south");

    const state = engine.getState();
    // Exactly 2, not 1 and not 3: the deck is the only place a draw count is visible without
    // arithmetic on a hand that the cost also shrank.
    expect(state.players.south.deck).toHaveLength(deckBefore - 2);
    expect(state.players.south.trash).toContain(seaquakeId);
    // Sai + Seaquake left the hand, 2 were drawn: 4 - 2 + 2.
    expect(state.players.south.hand).toHaveLength(4);
  });

  test("with no Event in hand the [On Play] publishes no prompt at all", () => {
    // `canPayCosts` runs BEFORE the `effectOptional` confirm is created, so an unpayable optional
    // block is silently skipped. Delete `cardCategory: "event"` and these two Characters become
    // payable, a confirm appears, and this goes red.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Sai045, op01Bellamy076, op10BlueGilly054],
        activeDon: 5,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Sai045, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.deck).toHaveLength(deckBefore);
  });

  test('"You may" is a real choice -- declining draws nothing and trashes nothing', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Sai045, op02Seaquake021, op04Barrier095],
        activeDon: 5,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Sai045, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south.deck).toHaveLength(deckBefore);
    expect(state.players.south.trash).toHaveLength(0);
    expect(state.players.south.hand).toHaveLength(2);
  });

  test("the printed [Blocker] works", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Sai045] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const saiId = engine.findCardInZone("south", "character", op15Sai045);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([saiId]);
  });
});
