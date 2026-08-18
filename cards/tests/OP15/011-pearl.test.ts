import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op02Kingdew006,
  op02Smoker093,
  op02Thatch007,
  op03Kuro021,
  op03Namule007,
  op15Pearl011,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op03Kuro021's traits are the single concatenated string "East Blue Black Cat Pirates", so
// `match: "includes"` is genuinely exercised; op02Smoker093 is the inert non-[East Blue] control.
//
// The basePower-vs-power discriminator for the [On K.O.] target: printed 5000 (inside "6000 base
// power or less") but CURRENT 9000 (outside it). `mutation_check.py` has no operator that rewrites
// `basePower` to `power`, so this is the only thing separating the two readings.
const buffedLowBaseBody: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP15-011-BUFFED-5000-BASE",
  canonicalId: "TEST-OP15-011-BUFFED-5000-BASE",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 4000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([buffedLowBaseBody]);

function pearlOnOpponentTurn(leaderCardId: CardRef) {
  return OnePieceTestEngine.create(
    { leaderCardId, character: [op15Pearl011] },
    { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

function pearlPower(engine: OnePieceTestEngine) {
  const pearlId = engine.findCardInZone("south", "character", op15Pearl011);
  return engine.getView("south").players.south.characters.find((c) => c?.instanceId === pearlId)
    ?.power;
}

describe("OP15-011 Pearl", () => {
  test("[Opponent's Turn] with an [East Blue] Leader: +2000 power and a real [Blocker]", () => {
    const engine = pearlOnOpponentTurn(op03Kuro021);
    const pearlId = engine.findCardInZone("south", "character", op15Pearl011);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    // 4000 printed. The exact number is what kills `value: 2000 -> 1000`.
    expect(pearlPower(engine)).toBe(6000);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    // A granted keyword has no projected field, so [Blocker] is proved functionally: Pearl is
    // active and must therefore be offered as a blocker. The candidate list carries a synthetic
    // "skip" entry alongside the real ones.
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([pearlId]);
  });

  test("on YOUR own turn the [Opponent's Turn] clause is off", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op03Kuro021, character: [op15Pearl011] },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    expect(pearlPower(engine)).toBe(4000);
  });

  test("with a Leader lacking the [East Blue] type the clause is off on the opponent's turn too", () => {
    const engine = pearlOnOpponentTurn(op02Smoker093);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    expect(pearlPower(engine)).toBe(4000);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    // No blocker step at all -- `promptQueue` retains RESOLVED prompts, so this filters for
    // pending ones rather than reading the raw queue.
    expect(
      engine
        .getState()
        .promptQueue.filter((prompt) => prompt.status === "pending")
        .map((prompt) => prompt.resolutionContext?.intent),
    ).not.toContain("battleBlocker");
  });

  test("[On K.O.] K.O.s only opponent Characters with 6000 base power or less", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op03Kuro021, character: [{ card: op15Pearl011, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [
          { card: op02Thatch007, playedOnTurn: 0 },
          op02Atmos003,
          op02Kingdew006,
          buffedLowBaseBody,
        ],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const pearlId = engine.findCardInZone("south", "character", op15Pearl011);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);
    const buffedId = engine.findCardInZone("north", "character", buffedLowBaseBody);

    // Thatch 8000 vs Pearl 4000 + 2000 = 6000, so the attack K.O.s her and fires the [On K.O.].
    engine.declareAttack(thatchId, pearlId, "north");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Pearl's K.O. target.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id).sort();
    // Atmos is EXACTLY 6000 (pins the threshold); Kingdew 7000 and Thatch 8000 are over; the
    // synthetic body is 5000 base / 9000 current and must be IN, which is what separates
    // `basePower` from `power`.
    expect(candidateIds).toEqual([atmosId, buffedId].sort());

    engine.resolveDecision("effectTargetSelection", { selectedIds: [buffedId] }, "south");
    expect(engine.getView("north").players.north.trash.map((card) => card.instanceId)).toContain(
      buffedId,
    );
  });

  test("[On K.O.] does nothing with a Leader lacking the [East Blue] type", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [{ card: op15Pearl011, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Thatch007, playedOnTurn: 0 }, op02Atmos003],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const pearlId = engine.findCardInZone("south", "character", op15Pearl011);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    // Pearl is 4000 here (no [Opponent's Turn] buff either), so Thatch still K.O.s her.
    engine.declareAttack(thatchId, pearlId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("north", "character", op02Atmos003)).toBe(atmosId);
  });
});
