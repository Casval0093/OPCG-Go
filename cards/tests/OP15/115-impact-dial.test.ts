import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Thatch007,
  op03Genzo046,
  op15ImpactDial115,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15ImpactDial115;

describe("OP15-115 Impact Dial", () => {
  test("[Main] K.O.s a cost-4-or-less Character and then adds a Life card to hand", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, hand: [CARD], activeDon: 2 },
      { character: [op02Atmos003, op02Thatch007] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const lifeBefore = engine.getView("south").players.south.lifeCount;

    engine.playCard(CARD, "south");

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected Impact Dial's K.O. target.");
    // Atmos is cost 4 (the boundary, included by `lte 4`); Thatch is cost 6 and must be excluded.
    expect(ko.candidates.map((candidate) => candidate.ref.id)).toEqual([atmosId]);
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(thatchId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [atmosId] }, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("north", "trash", op02Atmos003)).toBe(atmosId);
    expect(view.players.south.lifeCount).toBe(lifeBefore - 1);
    expect(view.players.south.hand).toHaveLength(1);
  });

  test("[Trigger] K.O.s but does NOT also take a Life card", () => {
    // The [Trigger] block is the K.O. alone. Copy the Life-to-hand action into it and this goes red --
    // the Life count would drop by 2 rather than 1 (the attack's own damage plus the effect's).
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: [op03Genzo046, op02Atmos003],
      },
      {
        // TWO bodies, not one. The [Trigger] block has its OWN copy of the `cost lte 4` filter, and
        // with a single cost-4 Character on the field nothing constrained it -- both deleting the
        // filter and flipping it to `gte` survived mutation. Thatch at cost 6 is what pins it.
        character: [
          { card: op02Atmos003, playedOnTurn: 0 },
          { card: op02Thatch007, playedOnTurn: 0 },
        ],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected the Trigger's K.O. target.");
    expect(ko.candidates.map((candidate) => candidate.ref.id)).toEqual([atmosId]);
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(thatchId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [atmosId] }, "south");

    expect(engine.findCardInZone("north", "trash", op02Atmos003)).toBe(atmosId);
    // 4 Life, minus the 1 consumed by the attack that revealed the Trigger.
    expect(engine.getView("south").players.south.lifeCount).toBe(3);
    // Activating the Trigger consumes the card, so nothing joined the hand.
    expect(engine.getView("south").players.south.hand).toHaveLength(0);
  });
});
