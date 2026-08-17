import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op16MonkeyDLuffy052 } from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-052 Monkey.D.Luffy", () => {
  test("gives 1 rested DON!! to the Leader, drawn from restedDon and not activeDon", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16MonkeyDLuffy052, playedOnTurn: 0 }, op02Atmos003],
        activeDon: 2,
        restedDon: 3,
      },
      {},
    );
    const luffyId = engine.findCardInZone("south", "character", op16MonkeyDLuffy052);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);
    const activeBefore = engine.getView("south").players.south.activeDon;
    const restedBefore = engine.getView("south").players.south.restedDon;

    engine.activateEffect(luffyId, "activateMain", "south");

    // A `giveDon` with `count.upTo` publishes the COUNT choice first; the recipient prompt is
    // the one after it (cards/ENCODING.md).
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const recipient = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(recipient?.kind).toBe("selectEntity");
    if (recipient?.kind !== "selectEntity") throw new Error("Expected Luffy's DON!! recipient.");
    // "your Leader or 1 of your Characters" -- both zones, this Character included.
    expect(recipient.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("south"), luffyId, atmosId].sort(),
    );
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.leader.attachedDon).toBe(1);
    // `donState: "rested"` draws from restedDon, leaving the active pool untouched.
    expect(view.players.south.restedDon).toBe(restedBefore - 1);
    expect(view.players.south.activeDon).toBe(activeBefore);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Once Per Turn]: a second activation on the same turn is not offered", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16MonkeyDLuffy052, playedOnTurn: 0 }],
        activeDon: 2,
        restedDon: 3,
      },
      {},
    );
    const luffyId = engine.findCardInZone("south", "character", op16MonkeyDLuffy052);

    engine.activateEffect(luffyId, "activateMain", "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [luffyId] }, "south");

    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === luffyId,
      ),
    ).toBe(false);
  });
});
