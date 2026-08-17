import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Genzo046, op15BarrierBulls019, op15Krieg001 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP15-019 Barrier Bulls", () => {
  test("[Main] draws 1 and buffs the Leader by +1000", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [op15BarrierBulls019],
        activeDon: 3,
        deck: [op03Genzo046, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15BarrierBulls019, "south");

    const view = engine.getView("south");
    expect(view.players.south.leader.power).toBe(6000);
    // The Event left hand and one card was drawn, so the hand is back to 1.
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.prompts).toHaveLength(0);
  });

  test("the Leader buff outlasts the turn -- untilEndOfOpponentNextEndPhase, not thisTurn", () => {
    // This is the assertion that pins the duration. Swap it to `thisTurn` and the buff is gone by the
    // time the opponent's turn starts, so this goes red at 5000.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [op15BarrierBulls019],
        activeDon: 3,
        deck: [op03Genzo046, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15BarrierBulls019, "south");
    engine.endTurn("south");

    expect(engine.getView("south").players.south.leader.power).toBe(6000);
  });

  test("[Trigger] debuffs up to 1 opponent Character by -4000", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, life: [op15BarrierBulls019] },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    // North attacks the Leader, taking a Life card; the revealed card has a [Trigger] so south is
    // offered its activation.
    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    const debuff = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(debuff?.kind).toBe("selectEntity");
    if (debuff?.kind !== "selectEntity") throw new Error("Expected the Trigger's debuff target.");
    expect(debuff.candidates.map((candidate) => candidate.ref.id)).toEqual([atmosId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [atmosId] }, "south");

    // Atmos is 6000 base; -4000 leaves 2000.
    expect(
      engine
        .getView("north")
        .players.north.characters.find((card) => card?.instanceId === atmosId)?.power,
    ).toBe(2000);
  });
});
