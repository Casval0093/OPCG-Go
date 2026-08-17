import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Kingdew006,
  op11XDrake017,
  op14eb04Absalom100,
  op16MarshallDTeach119,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [Trigger] is encoded -- see the PARKED note on the card for why the [On Play] is not.
// The [Trigger] fires for the DAMAGED player, so Teach sits in north's Life and south attacks the
// north Leader; both of the trigger's actions then aim at south's board.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function southBoard() {
  return {
    character: [
      // 7000 power, and cost 5 -- the exact boundary of "a cost of 5 or less".
      { card: op02Kingdew006, playedOnTurn: 0 },
      // Cost 3, and the only fixture with an observable [On K.O.] -- it is what makes the
      // `negateEffects` action provable rather than just logged.
      op14eb04Absalom100,
      // Cost 2 -- clear of the line, so `lte` and `gte` are distinguishable.
      op01Sai012,
      // Cost 6 -- the only body the cost filter excludes.
      op11XDrake017,
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

describe("OP16-119 Marshall.D.Teach", () => {
  test("[Trigger] negates any opponent Character but only K.O.s one costing 5 or less", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      { life: [op16MarshallDTeach119, op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const absalomId = engine.findCardInZone("south", "character", op14eb04Absalom100);
    const clearOfLineId = engine.findCardInZone("south", "character", op01Sai012);
    const tooExpensiveId = engine.findCardInZone("south", "character", op11XDrake017);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // The negate half carries no cost filter, so the cost-6 body IS a legal negate target even
    // though it can never be a legal K.O. target.
    const negate = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(negate?.kind).toBe("selectEntity");
    if (negate?.kind !== "selectEntity") throw new Error("Expected Teach's negate choice.");
    expect(negate.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [attackerId, absalomId, clearOfLineId, tooExpensiveId].sort(),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [absalomId] }, "north");

    const ko = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (ko?.kind !== "selectEntity") throw new Error("Expected Teach's K.O. choice.");
    expect(ko.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [attackerId, absalomId, clearOfLineId].sort(),
    );
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [absalomId] }, "north");

    expect(engine.getState().cards[absalomId]?.zone).toBe("trash");
    // Absalom's own [On K.O.] ("look at 3 cards from the top of your deck; reveal up to 1
    // {Thriller Bark Pirates} card") would publish a search prompt to south. It does not, because
    // the negate landed first -- this is the functional proof that `negateEffects` did something.
    expect(pendingIntents(engine)).not.toContain("effectSearchSelection");
  });

  test("[Trigger] declining the negate leaves the K.O.'d Character's own [On K.O.] intact", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      { life: [op16MarshallDTeach119, op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const absalomId = engine.findCardInZone("south", "character", op14eb04Absalom100);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");
    // "Up to 1" permits 0 (GENERAL ruling #5). This is the control for the test above.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [absalomId] }, "north");

    expect(engine.getState().cards[absalomId]?.zone).toBe("trash");
    expect(engine.pendingDecision("effectSearchSelection", "south").steps[0]?.kind).toBe(
      "selectEntity",
    );
  });
});
