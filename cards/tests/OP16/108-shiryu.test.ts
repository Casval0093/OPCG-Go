import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Sai012,
  op02Kingdew006,
  op09MarshallDTeach093,
  op10Liberation098,
  op10SanjuanWolf084,
  op16Shiryu108,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// "[Blackbeard Pirates] type CARD", not Character -- so the trash pool deliberately includes an
// Event at the cost boundary and there is no `cardCategory` filter to test.
function shiryuHandAndTrash() {
  return {
    hand: [op16Shiryu108, op01Sai012],
    activeDon: 6,
    trash: [
      // Event, cost 6 -- the exact boundary of "a cost of 6 or less", and proof the filter is not
      // secretly restricted to Characters.
      op10Liberation098,
      // Character, cost 5 -- clear of the line, so `lte` and `gte` are distinguishable.
      op10SanjuanWolf084,
      // Blackbeard Pirates but cost 10 -- the only body the cost filter excludes.
      op09MarshallDTeach093,
      // Cost 1 but not Blackbeard Pirates -- the only body the trait filter excludes.
      eb01Doma005,
    ],
  };
}

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-108 Shiryu", () => {
  test("[On Play] adds a cost-6-or-less [Blackbeard Pirates] card from the trash to Life face-up", () => {
    const engine = OnePieceTestEngine.create(shiryuHandAndTrash(), {}, SOUTH_ATTACKS);
    const boundaryId = engine.findCardInZone("south", "trash", op10Liberation098);
    const clearOfLineId = engine.findCardInZone("south", "trash", op10SanjuanWolf084);
    const tooExpensiveId = engine.findCardInZone("south", "trash", op09MarshallDTeach093);
    const wrongTraitId = engine.findCardInZone("south", "trash", eb01Doma005);
    const discardId = engine.findCardInZone("south", "hand", op01Sai012);
    const lifeBefore = engine.getState().players.south.life.length;

    engine.playCard(op16Shiryu108, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // Sai is the only other card in hand once Shiryu has left it, so the cost auto-pays with no
    // prompt at all -- there is no filter on this cost to exercise.
    expect(engine.getState().cards[discardId]?.zone).toBe("trash");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected Shiryu's trash choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, clearOfLineId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongTraitId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [clearOfLineId] }, "south");

    const state = engine.getState();
    expect(state.players.south.life).toHaveLength(lifeBefore + 1);
    expect(state.players.south.life[0]).toBe(clearOfLineId);
    // "face-up" is printed explicitly, and is the exception to GENERAL ruling #44.
    expect(state.cards[clearOfLineId]?.faceUp).toBe(true);
  });

  test('[On Play] "You may" is a real decline, leaving hand and Life untouched', () => {
    const engine = OnePieceTestEngine.create(shiryuHandAndTrash(), {}, SOUTH_ATTACKS);
    const discardId = engine.findCardInZone("south", "hand", op01Sai012);
    const candidateId = engine.findCardInZone("south", "trash", op10SanjuanWolf084);
    const lifeBefore = engine.getState().players.south.life.length;

    engine.playCard(op16Shiryu108, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.cards[discardId]?.zone).toBe("hand");
    expect(state.cards[candidateId]?.zone).toBe("trash");
    expect(state.players.south.life).toHaveLength(lifeBefore);
    expect(pendingIntents(engine)).toEqual([]);
  });

  test("[Trigger] draws 2 cards", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { life: [op16Shiryu108, op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const shiryuId = engine.findCardInZone("north", "life", op16Shiryu108);

    expect(engine.getView("north").players.north.hand).toHaveLength(0);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(2);
    expect(engine.getState().cards[shiryuId]?.zone).toBe("trash");
  });
});
