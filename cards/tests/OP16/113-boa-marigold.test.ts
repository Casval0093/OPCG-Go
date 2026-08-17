import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op02Kingdew006, op07BoaHancock038, op16BoaMarigold113 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-113 Boa Marigold", () => {
  test("gains [Blocker] at 2 Life", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { leaderCardId: op07BoaHancock038, life: 2, character: [op16BoaMarigold113] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const marigoldId = engine.findCardInZone("north", "character", op16BoaMarigold113);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a Blocker decision.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(marigoldId);

    engine.resolveDecision("battleBlocker", { selectedIds: [marigoldId] }, "north");
    expect(engine.getState().cards[marigoldId]?.rested).toBe(true);
  });

  test("has no [Blocker] at 4 Life", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      // 4 is clear of the threshold in a way 2 is not: at exactly 2, `lte 2` and `gte 2` both
      // hold, so only a case like this one proves the comparison is the right way round.
      { leaderCardId: op07BoaHancock038, life: 4, character: [op16BoaMarigold113] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    // Marigold is north's only Character, so with no keyword granted there is no blocker step at
    // all -- and the attack goes straight through to Life.
    expect(pendingIntents(engine)).not.toContain("battleBlocker");
    expect(engine.getState().players.north.life).toHaveLength(3);
  });

  test("[Trigger] plays it under a [Kuja Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op07BoaHancock038,
        life: [op16BoaMarigold113, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const marigoldId = engine.findCardInZone("north", "life", op16BoaMarigold113);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getState().cards[marigoldId]?.zone).toBe("character");
  });

  test("[Trigger] does nothing without a [Kuja Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { life: [op16BoaMarigold113, op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const marigoldId = engine.findCardInZone("north", "life", op16BoaMarigold113);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getState().cards[marigoldId]?.zone).toBe("trash");
    expect(engine.getState().players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });
});
