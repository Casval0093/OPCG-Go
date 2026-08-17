import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op15Enel058,
  op15Enel060,
  op15Krieg001,
  op15Varie074,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op15Enel058 is the Enel Leader and is fully parked (no encoded effects), so it is inert scenery
// here -- exactly what a fixture Leader should be. op15Enel060 is a Character named "Enel", used for
// the [Counter] name filter.

describe("OP15-074 Varie", () => {
  test("[Main] pays DON!! -1, draws 1, and gives one of your Characters +2 cost", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Enel058,
        hand: [op15Varie074],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
        character: [op03Genzo046],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const genzoId = engine.findCardInZone("south", "character", op03Genzo046);

    engine.playCard(op15Varie074, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [genzoId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(1);
    // Genzo's printed cost is 2; +2 makes it 4.
    expect(view.players.south.characters.find((card) => card?.instanceId === genzoId)?.cost).toBe(4);
    // The DON!! went back to the DON!! deck rather than to the rested pile.
    expect(view.players.south.activeDon).toBe(0);
    expect(view.players.south.restedDon).toBe(0);
  });

  test("ruling #913: with an [Enel] Leader and zero Characters, the DON!! -1 is still paid and the draw still happens", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Enel058,
        hand: [op15Varie074],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15Varie074, "south");

    // GENERAL ruling #27: a missing target does not abort the rest of the effect.
    expect(engine.getView("south").players.south.hand).toHaveLength(1);
    expect(engine.getView("south").players.south.activeDon).toBe(0);
  });

  test("with a non-[Enel] Leader the [Main] does nothing at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [op15Varie074],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
        character: [op03Genzo046],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15Varie074, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(0);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[Counter] boosts only a card named [Enel]", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      {
        leaderCardId: op15Enel058,
        hand: [op15Varie074],
        activeDon: 1,
        character: [op15Enel060, op02Atmos003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", op15Varie074);
    const enelCharacterId = engine.findCardInZone("north", "character", op15Enel060);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(boost?.kind).toBe("selectEntity");
    if (boost?.kind !== "selectEntity") throw new Error("Expected the [Enel] boost target.");
    const candidateIds = boost.candidates.map((candidate) => candidate.ref.id);
    // The Leader is named Enel too, so both it and the Enel Character qualify; Atmos does not.
    expect(candidateIds).toContain(engine.leader("north"));
    expect(candidateIds).toContain(enelCharacterId);
    expect(candidateIds).not.toContain(atmosId);
  });
});
