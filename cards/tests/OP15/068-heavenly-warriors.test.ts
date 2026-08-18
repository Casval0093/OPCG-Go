import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op15HeavenlyWarriors068, op16PortgasDAce001 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function underAttack(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [op15HeavenlyWarriors068],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "north" },
  );
  engine.declareAttack(
    engine.findCardInZone("north", "character", op02Atmos003),
    engine.leader("south"),
    "north",
  );
  return engine;
}

function blockerPromptPending(engine: OnePieceTestEngine) {
  return engine
    .getState()
    .promptQueue.some(
      (prompt) =>
        prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
    );
}

describe("OP15-068 Heavenly Warriors", () => {
  test("at 6 DON!! he is offered as a blocker", () => {
    // A CONDITIONAL [Blocker] is a granted keyword, not a printed one, and granted keywords have
    // no projected field -- so it is proven by the blocker step actually opening.
    const engine = underAttack(6);
    const warriorsId = engine.findCardInZone("south", "character", op15HeavenlyWarriors068);

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(warriorsId);
  });

  test("well under the threshold: at 3 DON!! he still blocks", () => {
    // Separates `lte 6` from `gte 6`; at exactly 6 both comparisons hold.
    const engine = underAttack(3);
    const warriorsId = engine.findCardInZone("south", "character", op15HeavenlyWarriors068);

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(warriorsId);
  });

  test("at 7 DON!! the blocker step never opens", () => {
    // Naming the intent rather than "no prompts at all": a Leader taking damage can legitimately
    // publish a lifeTrigger, which says nothing about blocking.
    expect(blockerPromptPending(underAttack(7))).toBe(false);
  });
});
