import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Thatch007,
  op03Genzo046,
  op15IFindItEmbarrassingAsAHumanBeing097,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15IFindItEmbarrassingAsAHumanBeing097;

describe("OP15-097 I Find It Embarrassing as a Human Being", () => {
  test("ruling #931, hand branch: 9 cards in the trash is enough, because the Event counts itself", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        trash: Array.from({ length: 9 }, () => op03Genzo046),
      },
      { character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const targetId = engine.findCardInZone("north", "character", op03Genzo046);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");

    // Played from hand the Event reaches the trash before its [Main] resolves, making 10.
    engine.endTurn("south");
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "north",
        attackerId: targetId,
        targetId: engine.leader("south"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
  });

  test("8 cards in the trash is one short and nothing happens", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        trash: Array.from({ length: 8 }, () => op03Genzo046),
      },
      { character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("the attack lock is restricted to a BASE cost of 5 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        trash: Array.from({ length: 9 }, () => op03Genzo046),
      },
      {
        character: [
          { card: op03Genzo046, playedOnTurn: 0 }, // base cost 2 -> eligible
          { card: op02Thatch007, playedOnTurn: 0 }, // base cost 6 -> excluded
          { card: op02Atmos003, playedOnTurn: 0 }, // base cost 4 -> eligible
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const cheapId = engine.findCardInZone("north", "character", op03Genzo046);
    const expensiveId = engine.findCardInZone("north", "character", op02Thatch007);
    const midId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(CARD, "south");

    const lock = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(lock?.kind).toBe("selectEntity");
    if (lock?.kind !== "selectEntity") throw new Error("Expected the cannotAttack target.");
    const candidateIds = lock.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([cheapId, midId]);
    expect(candidateIds).not.toContain(expensiveId);
  });

  test("ruling #931, Trigger branch: at 9 cards in the trash the [Trigger] does NOTHING", () => {
    // The asymmetry this card is famous for, and the engine produces it for free: a Life card with a
    // [Trigger] moves to the `resolution` zone rather than the trash (battle.ts), so the count stays
    // at 9 and the re-activated [Main] finds its condition unmet. The hand branch above, at the same
    // 9 cards, DOES fire. Both must hold, which is why this card is tested from both directions.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: [op03Genzo046, op02Atmos003],
        trash: Array.from({ length: 9 }, () => op03Genzo046),
      },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    // No target prompt: the [Main] re-activated, found 9 < 10, and did nothing.
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
