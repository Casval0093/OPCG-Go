import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Atmos003,
  op02Kingdew006,
  op09MarshallDTeach081,
  op16Laffitte114,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Laffitte's [On K.O.] fires for its own controller, so every test seats it NORTH and has SOUTH
// battle-K.O. it. `op02Kingdew006` is the attacker throughout: cost 5, so it is outside "a cost of
// 4 or less" and stays out of the K.O. candidates it would otherwise pollute after resting.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

describe("OP16-114 Laffitte", () => {
  test("[On K.O.] K.O.s only an opponent Character with a cost of 4 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op02Kingdew006, playedOnTurn: 0 }, op02Atmos003, op01Sai012],
      },
      { character: [{ card: op16Laffitte114, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const laffitteId = engine.findCardInZone("north", "character", op16Laffitte114);
    // Cost 4 exactly -- the boundary body. A below-the-line fixture alone would leave a
    // `lte 4 -> lte 3` reading indistinguishable from the real one.
    const boundaryId = engine.findCardInZone("south", "character", op02Atmos003);
    // Cost 2 -- well clear of the line, so it separates `lte` from `gte`, which agree at 4.
    const clearOfLineId = engine.findCardInZone("south", "character", op01Sai012);
    // Cost 5 -- the only thing the cost filter actually excludes.
    const tooExpensiveId = attackerId;

    engine.declareAttack(attackerId, laffitteId, "south");

    const choice = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected Laffitte's K.O. choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, clearOfLineId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [boundaryId] }, "north");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === boundaryId)).toBe(
      false,
    );
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(boundaryId);
    expect(view.players.south.characters.some((card) => card?.instanceId === clearOfLineId)).toBe(
      true,
    );
  });

  test("[On K.O.] targets the opponent's Characters, never its own controller's", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }, op01Sai012] },
      { character: [{ card: op16Laffitte114, rested: true }, op02Atmos003] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const laffitteId = engine.findCardInZone("north", "character", op16Laffitte114);
    const ownAllyId = engine.findCardInZone("north", "character", op02Atmos003);
    const opponentBodyId = engine.findCardInZone("south", "character", op01Sai012);

    engine.declareAttack(attackerId, laffitteId, "south");

    const choice = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Laffitte's K.O. choice.");
    // op02Atmos003 is cost 4 on BOTH sides of the table here, so only `player: "opponent"`
    // keeps north's own copy out of the pool.
    expect(choice.candidates.map((candidate) => candidate.ref.id)).toEqual([opponentBodyId]);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(ownAllyId);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      engine.leader("south"),
    );
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }, op02Atmos003] },
      { leaderCardId: op09MarshallDTeach081, life: [op16Laffitte114, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const laffitteId = engine.findCardInZone("north", "life", op16Laffitte114);
    const targetId = engine.findCardInZone("south", "character", op02Atmos003);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "north");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(targetId);
    // Activating a [Trigger] consumes the card to the trash rather than adding it to hand
    // (GENERAL ruling #21).
    expect(engine.getState().cards[laffitteId]?.zone).toBe("trash");
  });
});
