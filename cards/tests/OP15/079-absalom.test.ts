import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Thatch007,
  op06GeckoMoria080,
  op06Lola094,
  op15Absalom079,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ACTS = { firstPlayer: "south", activeSeat: "north" } as const;

// op06Lola094 is a vanilla [Thriller Bark Pirates] body; op02Atmos003 is a vanilla
// [Whitebeard Pirates] one. The second exists purely so `delete filter:trait` has something to
// wrongly admit -- it is right about every other quality (a Character, in the same trash).
function trashSelection(engine: OnePieceTestEngine) {
  const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
  if (step?.kind !== "selectEntity") throw new Error("Expected Absalom's trash selection.");
  return step.candidates.map((candidate) => candidate.ref.id);
}

describe("OP15-079 Absalom", () => {
  test("ruling #918: the [On K.O.] may add THIS card itself back to hand", () => {
    // 可以. Both K.O. paths call moveCard(... "trash") before enqueueing "onKo", so Absalom is
    // already in the trash it scans. An `excludeSelf` filter would break this ruling, which is
    // why there isn't one.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        character: [{ card: op15Absalom079, rested: true }],
        trash: [op06Lola094, op02Atmos003],
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ACTS,
    );
    const absalomId = engine.findCardInZone("south", "character", op15Absalom079);
    const lolaId = engine.findCardInZone("south", "trash", op06Lola094);
    const atmosId = engine.findCardInZone("south", "trash", op02Atmos003);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, absalomId, "north");

    const candidateIds = trashSelection(engine);
    expect([...candidateIds].sort()).toEqual([absalomId, lolaId].sort());
    // The trait filter is real: a [Whitebeard Pirates] card in the same trash is excluded.
    expect(candidateIds).not.toContain(atmosId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [absalomId] }, "south");

    expect(engine.getState().cards[absalomId]?.zone).toBe("hand");
  });

  test("ruling #919: reached through its own [Trigger] it may NOT add itself", () => {
    // 不可以, and for a zone reason rather than a filter one: a Life card being activated sits in
    // the `resolution` zone, so it is not in the trash the very same onKo block scans. The
    // encoding is identical in both directions; only the card's location differs.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        life: [op15Absalom079, op02Atmos003, op02Atmos003],
        trash: [op06Lola094],
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ACTS,
    );
    const absalomId = engine.findCardInZone("south", "life", op15Absalom079);
    const lolaId = engine.findCardInZone("south", "trash", op06Lola094);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, engine.leader("south"), "north");
    // `lifeTrigger` takes `activate`, not `yes`; an unrecognised optionId is a silent skip.
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    const candidateIds = trashSelection(engine);
    expect(candidateIds).toEqual([lolaId]);
    expect(candidateIds).not.toContain(absalomId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [lolaId] }, "south");

    const state = engine.getState();
    expect(state.cards[lolaId]?.zone).toBe("hand");
    // Activating a [Trigger] consumes the card to the trash; it does not also join the hand.
    expect(state.cards[absalomId]?.zone).toBe("trash");
  });
});
