import { describe, expect, test } from "vite-plus/test";
import {
  eb03Yamato057,
  op03Nero087,
  op04Ideo077,
  op10Ryuma094,
  op16MonkeyDLuffy095,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function withBoard() {
  return OnePieceTestEngine.create(
    {
      hand: [op16MonkeyDLuffy095],
      character: [
        // Black AND [Land of Wano]: the only legal recipient.
        { card: op10Ryuma094, playedOnTurn: 0 },
        // [Land of Wano] but yellow -- excluded by the colour filter alone.
        eb03Yamato057,
        // Black but CP9 -- excluded by the trait filter alone.
        op03Nero087,
      ],
      activeDon: op16MonkeyDLuffy095.cost,
    },
    // op04Ideo077's whole printed ability is [Blocker], so it cannot contribute anything else to
    // the outcome below.
    { character: [op04Ideo077] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP16-095 Monkey.D.Luffy", () => {
  test("control: without the grant, the same attack opens a blocker step", () => {
    // This is what makes the [Unblockable] assertion in the next test mean something -- it shows
    // the blocker step is genuinely available on this board and is skipped only by the grant.
    const engine = withBoard();
    const attackerId = engine.findCardInZone("south", "character", op10Ryuma094);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Ideo's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(
      engine.findCardInZone("north", "character", op04Ideo077),
    );
  });

  test("grants [Unblockable] to a black [Land of Wano] Character only, and the blocker step is skipped", () => {
    const engine = withBoard();
    const attackerId = engine.findCardInZone("south", "character", op10Ryuma094);
    const wrongColorId = engine.findCardInZone("south", "character", eb03Yamato057);
    const wrongTraitId = engine.findCardInZone("south", "character", op03Nero087);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op16MonkeyDLuffy095, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Luffy's keyword target.");
    expect(selection).toMatchObject({ min: 0, max: 1 });
    const ids = selection.candidates.map((candidate) => candidate.ref.id);
    // Luffy himself is black but [Straw Hat Crew]/[Land of Wano] -- he qualifies too, so assert
    // membership rather than an exact list, and assert the two exclusions individually.
    expect(ids).toContain(attackerId);
    expect(ids).not.toContain(wrongColorId);
    expect(ids).not.toContain(wrongTraitId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [attackerId] }, "south");

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    // Granted keywords have no projected field to read, so the proof has to be behavioural: the
    // battle resolved to completion in one call, with no blocker step for north to answer, and
    // Ryuma's 6000 beat the 5000 Leader.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north.lifeCount).toBe(lifeBefore - 1);
  });
});
