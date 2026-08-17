import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op15Enel058,
  op15Enel060,
  op15Krieg001,
  op15LightningBeastKiten076,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15LightningBeastKiten076;

describe("OP15-076 Lightning Beast Kiten", () => {
  test("[Main] pays DON!! -1, draws 1, and gives an opponent Character -1000", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Enel058,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      { character: [op03Genzo046] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const genzoId = engine.findCardInZone("north", "character", op03Genzo046);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [genzoId] }, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(1);
    expect(engine.getView("south").players.south.activeDon).toBe(0);
    expect(
      engine
        .getView("north")
        .players.north.characters.find((card) => card?.instanceId === genzoId)?.power,
    ).toBe(3000);
  });

  test("with a non-[Enel] Leader the [Main] does nothing and the DON!! is not paid", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      { character: [op03Genzo046] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(0);
    expect(engine.getView("south").players.south.activeDon).toBe(1);
  });

  test("[Counter] boosts only a card named [Enel]", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      { leaderCardId: op15Enel058, hand: [CARD], activeDon: 1, character: [op15Enel060, op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);
    const enelId = engine.findCardInZone("north", "character", op15Enel060);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(boost?.kind).toBe("selectEntity");
    if (boost?.kind !== "selectEntity") throw new Error("Expected the [Enel] boost target.");
    expect(boost.candidates.map((candidate) => candidate.ref.id)).toContain(enelId);
    expect(boost.candidates.map((candidate) => candidate.ref.id)).not.toContain(atmosId);
  });
});
