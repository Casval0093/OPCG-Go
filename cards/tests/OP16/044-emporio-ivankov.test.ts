import { describe, expect, test } from "vite-plus/test";
import { op02LittleoarsJr020, op16EmporioIvankov044 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-044 Emporio.Ivankov", () => {
  // The entire card is [Blocker] plus its printed reminder text. Granted or printed, a keyword
  // has no projected field, so the only real assertion is a functional one: Ivankov is offered
  // in the public blocker step and, once chosen, actually becomes the attack's target.
  test("is offered as a Blocker and becomes the new target of the attack", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { character: [op16EmporioIvankov044] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const ivankovId = engine.findCardInZone("north", "character", op16EmporioIvankov044);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Ivankov's Blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(ivankovId);
    engine.resolveDecision("battleBlocker", { selectedIds: [ivankovId] }, "north");

    const view = engine.getView("north");
    // 9000 into a 2000-power blocker: Ivankov is K.O.'d, and the Leader takes no damage --
    // which is the point of the redirect.
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(ivankovId);
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.prompts).toHaveLength(0);
  });
});
