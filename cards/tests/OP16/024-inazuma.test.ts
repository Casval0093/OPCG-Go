import { describe, expect, test } from "vite-plus/test";
import { eb01TBone049, op02Kingdew006, op03Namule007, op16Inazuma024 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-024 Inazuma", () => {
  test("K.O.'d by the opponent's effect: rests one of the OPPONENT's Characters, never one of yours", () => {
    // eb01TBone049 is "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 2 or
    // less" -- Inazuma costs exactly 2, so north can remove it by effect.
    const engine = OnePieceTestEngine.create(
      { character: [op16Inazuma024, op03Namule007] },
      { character: [op02Kingdew006], hand: [eb01TBone049], activeDon: 5 },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const inazumaId = engine.findCardInZone("south", "character", op16Inazuma024);
    const ownAllyId = engine.findCardInZone("south", "character", op03Namule007);
    const opponentBodyId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.playCard(eb01TBone049, "north");
    const tboneId = engine.findCardInZone("north", "character", eb01TBone049);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [inazumaId] }, "north");

    // Inazuma is in the trash and its own trigger is now asking SOUTH to rest something.
    const rest = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(rest?.kind).toBe("selectEntity");
    if (rest?.kind !== "selectEntity") throw new Error("Expected Inazuma's rest choice.");
    const candidateIds = rest.candidates.map((candidate) => candidate.ref.id);
    // "your opponent's Characters" is relative to Inazuma's controller: north's bodies only.
    expect(candidateIds.sort()).toEqual([opponentBodyId, tboneId].sort());
    expect(candidateIds).not.toContain(ownAllyId);
    expect(candidateIds).not.toContain(engine.leader("north"));

    engine.resolveDecision("effectTargetSelection", { selectedIds: [opponentBodyId] }, "south");

    expect(engine.getState().cards[opponentBodyId]?.rested).toBe(true);
    expect(engine.getState().cards[ownAllyId]?.rested).toBe(false);
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      inazumaId,
    );
  });

  test("a BATTLE K.O. does not fire it -- `source: \"opponentEffect\"` excludes koCause 'battle'", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Inazuma024, rested: true }] },
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const inazumaId = engine.findCardInZone("south", "character", op16Inazuma024);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    // 7000 into a rested 1000: Inazuma dies in battle rather than to an effect.
    engine.declareAttack(attackerId, inazumaId, "north");

    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      inazumaId,
    );
    // Nothing to resolve for either seat: the [On K.O.] must have stayed silent.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("north").prompts).toHaveLength(0);
    expect(engine.getState().promptQueue).toHaveLength(0);
  });

  test("[Blocker] is a real printed keyword, not decoration", () => {
    const engine = OnePieceTestEngine.create(
      { character: [op16Inazuma024] },
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const inazumaId = engine.findCardInZone("south", "character", op16Inazuma024);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    // Without `keywords: ["blocker"]` there is no such prompt and pendingDecision throws.
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Inazuma's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(inazumaId);

    engine.resolveDecision("battleBlocker", { selectedIds: [inazumaId] }, "south");
    expect(engine.getState().cards[inazumaId]?.rested).toBe(true);
  });
});
