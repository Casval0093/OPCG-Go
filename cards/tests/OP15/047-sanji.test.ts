import { describe, expect, test } from "vite-plus/test";
import {
  op02Smoker093,
  op02Thatch007,
  op04Ideo077,
  op10BlueGilly054,
  op15Sanji047,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function withBoard() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      hand: [op15Sanji047],
      character: [{ card: op10BlueGilly054, playedOnTurn: 0 }],
      activeDon: op15Sanji047.cost,
    },
    // op04Ideo077's whole printed ability is [Blocker], so it cannot contribute anything else.
    { leaderCardId: op02Smoker093, character: [op04Ideo077] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-047 Sanji", () => {
  test("control: without the grant, the same attack opens a blocker step", () => {
    // This is what makes the [Unblockable] assertion below mean something -- a granted keyword has
    // no projected field, so "no prompt" is otherwise indistinguishable from a broken fixture.
    const engine = withBoard();
    const attackerId = engine.findCardInZone("south", "character", op10BlueGilly054);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Ideo's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(
      engine.findCardInZone("north", "character", op04Ideo077),
    );
  });

  test("[On Play] grants [Unblockable] to one of YOUR Characters and the blocker step is skipped", () => {
    const engine = withBoard();
    const attackerId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const opponentBodyId = engine.findCardInZone("north", "character", op04Ideo077);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op15Sanji047, "south");
    const sanjiId = engine.findCardInZone("south", "character", op15Sanji047);

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Sanji's keyword target.");
    expect(selection).toMatchObject({ min: 0, max: 1 });
    const ids = selection.candidates.map((candidate) => candidate.ref.id);
    // No filters at all on this target, so both own Characters qualify -- but `player: "self"`
    // still has to exclude the opponent's body, and `zones: ["character"]` the Leaders.
    expect(ids).toEqual(expect.arrayContaining([attackerId, sanjiId]));
    expect(ids).not.toContain(opponentBodyId);
    expect(ids).not.toContain(engine.leader("south"));
    engine.resolveDecision("effectTargetSelection", { selectedIds: [attackerId] }, "south");

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    // Battle resolved to completion in one call with no blocker step for north to answer, and
    // Blue Gilly's 5000 met the 5000 Leader.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("the printed [Blocker] works", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Sanji047] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const sanjiId = engine.findCardInZone("south", "character", op15Sanji047);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([sanjiId]);
  });
});
