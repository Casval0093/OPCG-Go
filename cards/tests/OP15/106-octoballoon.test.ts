import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Kingdew006,
  op03CharlottePraline111,
  op03Namule007,
  op05UpperYard117,
  op12Baby5111,
  op15Octoballoon106,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// North's hand is what the play offer draws from:
//   op12Baby5111              yellow, cost 2  -- exactly on the line, legal
//   op03CharlottePraline111   yellow, cost 3  -- one over, illegal
//   op01Sai012                RED,    cost 2  -- right cost, wrong colour, illegal
//   op05UpperYard117          yellow STAGE, cost 1 -- legal: the card prints "Character or Stage"
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function octoballoonTrigger(hand: PlayerFixture["hand"]) {
  return OnePieceTestEngine.create(
    { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
    {
      life: [op15Octoballoon106, op01Sai012, op01Sai012],
      hand,
      // An explicit deck so the draw cannot add an unexpected card to the play candidates.
      deck: [op03Namule007, op03Namule007, op03Namule007],
    },
    SOUTH_ATTACKS,
  );
}

describe("OP15-106 Octoballoon", () => {
  test("[Trigger] draws 1, then offers a yellow cost-2-or-less Character or Stage", () => {
    const engine = octoballoonTrigger([
      op12Baby5111,
      op03CharlottePraline111,
      op01Sai012,
      op05UpperYard117,
    ]);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const babyId = engine.findCardInZone("north", "hand", op12Baby5111);
    const pralineId = engine.findCardInZone("north", "hand", op03CharlottePraline111);
    const saiId = engine.findCardInZone("north", "hand", op01Sai012);
    const upperYardId = engine.findCardInZone("north", "hand", op05UpperYard117);
    const handBefore = engine.getState().players.north.hand.length;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    // A defender holding cards opens a counter step before damage resolves.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getState().players.north.hand).toHaveLength(handBefore + 1);

    const selection = engine.pendingDecision("effectPlaySelection", "north").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a play selection.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id);
    // The Stage is in the pool, which is what proves NOT adding a `cardCategory` filter is right.
    expect(candidateIds.sort()).toEqual([babyId, upperYardId].sort());
    expect(candidateIds).not.toContain(pralineId);
    expect(candidateIds).not.toContain(saiId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [babyId] }, "north");
    expect(engine.getState().cards[babyId]?.zone).toBe("character");
  });

  test("the Stage really can be played, not just offered", () => {
    const engine = octoballoonTrigger([op05UpperYard117, op12Baby5111]);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const upperYardId = engine.findCardInZone("north", "hand", op05UpperYard117);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [upperYardId] }, "north");

    expect(engine.getState().cards[upperYardId]?.zone).toBe("stage");
  });

  test("with nothing playable the draw still happens and no play prompt appears", () => {
    const engine = octoballoonTrigger([op03CharlottePraline111, op01Sai012]);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const handBefore = engine.getState().players.north.hand.length;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // An `upTo` target with zero legal candidates publishes no prompt at all.
    expect(
      engine
        .getState()
        .promptQueue.filter(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectPlaySelection",
        ),
    ).toHaveLength(0);
    expect(engine.getState().players.north.hand).toHaveLength(handBefore + 1);
    expect(engine.getState().players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });
});
