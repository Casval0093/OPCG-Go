import { describe, expect, test } from "vite-plus/test";
import type { EventCard } from "@tcg/op-types";
import {
  eb01OffWhite019,
  op02Atmos003,
  op02LittleoarsJr020,
  op03Namule007,
  op03Pearl031,
  op16Morley033,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Same technique as tests/cards/characters/op05-032-pica.test.ts: a 0-cost effect K.O. so the
// replacement can be exercised on an ACTIVE Morley, which a battle K.O. can never do (only the
// Leader and rested Characters are legal attack targets).
const koByEffect: EventCard = {
  ...eb01OffWhite019,
  id: "TEST-OP16-033-KO",
  canonicalId: "TEST-OP16-033-KO",
  name: "Morley K.O. Review",
  cost: 0,
  effect: "[Main] K.O. up to 1 of your opponent's Characters.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "ko",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
          },
        ],
      },
    ],
  },
};

registerCards([koByEffect]);

describe("OP16-033 Morley", () => {
  test("a battle K.O. can be replaced by resting 2 of your cards, Leader included", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: op16Morley033, rested: true },
          op03Namule007,
          { card: op02Atmos003, rested: true },
        ],
      },
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const morleyId = engine.findCardInZone("south", "character", op16Morley033);
    const activeAllyId = engine.findCardInZone("south", "character", op03Namule007);
    const restedAllyId = engine.findCardInZone("south", "character", op02Atmos003);
    const leaderId = engine.leader("south");
    const attackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);

    // 9000 into a rested 5000. `replacedEvent: "ko"` is what makes this reachable at all --
    // findKoReplacement searches ["ko", "leaveField"] when the cause is a battle.
    engine.declareAttack(attackerId, morleyId, "north");
    engine.resolveDecision("battleKoReplacement", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(payment?.kind).toBe("selectEntity");
    if (payment?.kind !== "selectEntity") throw new Error("Expected Morley's rest payment.");
    expect(payment.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [leaderId, activeAllyId].sort(),
    );
    // Already-rested cards are not payable: Morley itself is rested here (it had to be, to be
    // attacked at all) and so is Atmos.
    expect(payment.candidates.map((candidate) => candidate.ref.id)).not.toContain(restedAllyId);
    expect(payment.candidates.map((candidate) => candidate.ref.id)).not.toContain(morleyId);
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [leaderId, activeAllyId] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === morleyId)).toBe(true);
    expect(view.players.south.trash.map((card) => card.instanceId)).not.toContain(morleyId);
    expect(engine.getState().cards[leaderId]?.rested).toBe(true);
    expect(engine.getState().cards[activeAllyId]?.rested).toBe(true);
  });

  test("ruling #980: an active Morley may be one of the two cards it rests to save itself", () => {
    // South's whole field is the Leader plus Morley, so the two payable cards ARE the Leader
    // and Morley itself -- exactly the pair the ruling allows (可以). With an `excludeSelf` on
    // the payment there would be only one candidate, the replacement would fail
    // replacementActionIsAvailable, and Morley would simply die with no prompt at all.
    const engine = OnePieceTestEngine.create(
      { character: [op16Morley033] },
      { hand: [koByEffect] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const morleyId = engine.findCardInZone("south", "character", op16Morley033);
    const leaderId = engine.leader("south");

    engine.playCard(koByEffect, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [morleyId] }, "north");
    engine.resolveDecision("effectKoReplacement", { optionId: "yes" }, "south");

    // Exactly two candidates, so the payment auto-resolves with no selection prompt.
    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === morleyId)).toBe(true);
    expect(engine.getState().cards[morleyId]?.rested).toBe(true);
    expect(engine.getState().cards[leaderId]?.rested).toBe(true);
    expect(view.prompts).toHaveLength(0);
  });

  test("with only 1 restable card the replacement is not offered at all -- the cost is 2, not 1", () => {
    // The mutation checker never perturbs a single-digit count, so `amount: 2` is pinned by
    // hand. Morley is rested (hence unpayable), leaving the Leader as the only candidate.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Morley033, rested: true }] },
      { hand: [koByEffect] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const morleyId = engine.findCardInZone("south", "character", op16Morley033);
    const leaderId = engine.leader("south");

    engine.playCard(koByEffect, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [morleyId] }, "north");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(morleyId);
    expect(engine.getState().cards[leaderId]?.rested).toBe(false);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Unblockable] is real: an active [Blocker] is never offered against Morley", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: op16Morley033, playedOnTurn: 0 },
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
        ],
      },
      { character: [op03Pearl031] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const morleyId = engine.findCardInZone("south", "character", op16Morley033);
    const plainAttackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const blockerId = engine.findCardInZone("north", "character", op03Pearl031);

    // Control on the same fixture: an attacker without the keyword DOES open the blocker step.
    engine.declareAttack(plainAttackerId, engine.leader("north"), "south");
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(blockerId);
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "north");

    engine.declareAttack(morleyId, engine.leader("north"), "south");
    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
        ),
    ).toBe(false);
  });
});
