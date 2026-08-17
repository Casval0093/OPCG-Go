import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02LittleoarsJr020,
  op03Namule007,
  op11XDrake017,
  op16VascoShot110,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// op02LittleoarsJr020 is the attacker everywhere: cost 7, so it is outside "a cost of 6 or less"
// and its post-attack rested state cannot be mistaken for the effect's work.
function southBoard() {
  return {
    character: [
      { card: op02LittleoarsJr020, playedOnTurn: 0 },
      // cost 6 -- the exact boundary.
      op11XDrake017,
      // cost 3 -- clear of the line, separating `lte` from `gte`.
      op03Namule007,
    ],
  };
}

describe("OP16-110 Vasco Shot", () => {
  test("[On K.O.] draws 1 and rests an opponent Character with a cost of 6 or less", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      { character: [{ card: op16VascoShot110, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const vascoId = engine.findCardInZone("north", "character", op16VascoShot110);
    const boundaryId = engine.findCardInZone("south", "character", op11XDrake017);
    const clearOfLineId = engine.findCardInZone("south", "character", op03Namule007);

    expect(engine.getState().cards[boundaryId]?.rested).toBe(false);

    engine.declareAttack(attackerId, vascoId, "south");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);

    const choice = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected Vasco Shot's rest choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, clearOfLineId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(attackerId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [boundaryId] }, "north");

    const state = engine.getState();
    expect(state.cards[boundaryId]?.rested).toBe(true);
    expect(state.cards[clearOfLineId]?.rested).toBe(false);
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      {
        life: [op16VascoShot110, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const vascoId = engine.findCardInZone("north", "life", op16VascoShot110);
    const targetId = engine.findCardInZone("south", "character", op03Namule007);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "north");

    expect(engine.getState().cards[targetId]?.rested).toBe(true);
    expect(engine.getState().cards[vascoId]?.zone).toBe("trash");
  });
});
