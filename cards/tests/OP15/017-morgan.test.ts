import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op02Thatch007, op03Namule007, op15Morgan017 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the printed [Blocker] is encoded. The whole [Activate: Main] is parked -- see the card file:
// `giveDon` always sources the DON!! from the effect controller's own cost area, while rulings
// #872/#874 require the source to follow the chosen target's controller, and the `giveDon` COST is
// hardwired to "your own ACTIVE DON!! to your own Leader or Character", which is not this cost.

describe("OP15-017 Morgan", () => {
  test("the printed [Blocker] works", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Morgan017, op03Namule007] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const morganId = engine.findCardInZone("south", "character", op15Morgan017);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    // A granted or printed keyword has no projected field, so [Blocker] is proved functionally.
    // Namule is on the field too and is NOT a blocker, so the candidate list distinguishes the
    // keyword from "any active Character may block".
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([morganId]);

    engine.resolveDecision("battleBlocker", { selectedIds: [morganId] }, "south");
    // Blocking rests the blocker and redirects the attack; Thatch 8000 beats Morgan 6000.
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      morganId,
    );
  });

  test("the parked [Activate: Main] is genuinely absent, not silently approximated", () => {
    // This records the park rather than asserting a behaviour: with no encoded `activateMain`
    // block the command is rejected outright. When the missing DON!!-source primitive lands and
    // the clause is encoded, this test goes red and forces someone to replace it with a real one.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Morgan017], activeDon: 5, restedDon: 5 },
      { leaderCardId: op02Smoker093, character: [op03Namule007], activeDon: 0, restedDon: 5 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const morganId = engine.findCardInZone("south", "character", op15Morgan017);

    const rejection = engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: morganId,
      trigger: "activateMain",
    });
    expect(rejection.reason).toBe("This card does not have that activation timing.");
  });
});
