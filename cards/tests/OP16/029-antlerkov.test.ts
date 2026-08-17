import { describe, expect, test } from "vite-plus/test";
import { eb01Doma005, eb01MountainGod018, op16Antlerkov029, op16Bunkov025 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-029 Antlerkov", () => {
  test("with Bunkov on field, plays only a cost-2-or-less Character from hand when attacking", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }, op16Bunkov025],
        hand: [eb01Doma005, eb01MountainGod018],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);
    const tooExpensiveId = engine.findCardInZone("south", "hand", eb01MountainGod018);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Antlerkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleId] }, "south");

    expect(engine.findCardInZone("south", "character", eb01Doma005)).toBe(eligibleId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("without Bunkov on field, attacking does not offer the hand-play at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }],
        hand: [eb01Doma005],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(
      engine.findCardInZone("south", "hand", eb01Doma005),
    );
  });
});
