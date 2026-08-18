import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op03Namule007,
  op15Ohm061,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// south is second, so it may attack on its own first turn.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function ohmAttacking(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [{ card: op15Ohm061, playedOnTurn: 0 }],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    {
      leaderCardId: op16PortgasDAce001,
      // Two opponent bodies: the target and a bystander, so "who got hit" is assertable.
      // north's hand stays empty so no battleCounter step interrupts the trigger.
      character: [op02Atmos003, op03Namule007],
    },
    SOUTH_ATTACKS,
  );
  engine.declareAttack(
    engine.findCardInZone("south", "character", op15Ohm061),
    engine.leader("north"),
    "south",
  );
  return engine;
}

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("north")
    .players.north.characters.find((entry) => entry?.instanceId === instanceId)?.power;
}

describe("OP15-061 Ohm", () => {
  test("[On Play] DON!! -1: paying returns a DON!! to the DON!! deck and draws exactly 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Ohm061],
        deck: [eb01Doma005, op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const topId = engine.getState().players.south.deck[0];

    engine.playCard(op15Ohm061, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // Paying a card's own cost RESTS that DON!!, so by the time the [On Play] cost is paid the
    // player holds two KINDS of DON!! (1 active, 1 rested) and `returnDon` therefore publishes a
    // real payment prompt -- the auto-pay shortcut only applies while a single kind is held.
    const payment = engine.pendingDecision("effectCostReturnDon", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected the DON!! -1 payment.");
    expect(payment.candidates.map((candidate) => candidate.ref.id)).toEqual([
      "active-don:0",
      "rested-don:0",
    ]);
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const state = engine.getState();
    // Cost 1 paid by resting 1 DON!!, then DON!! -1 RETURNS the other one: 0 active, 1 rested,
    // and the DON!! deck climbs back to 9. A `restDon` cost would leave the deck at 8.
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 9 });
    expect(state.players.south.hand).toEqual([topId]);
  });

  test("[On Play] declining keeps the DON!! and draws nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Ohm061],
        deck: [eb01Doma005, op03Namule007],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );

    engine.playCard(op15Ohm061, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 1, restedDon: 1, donDeckCount: 8 });
    expect(state.players.south.hand).toHaveLength(0);
  });

  test("[When Attacking] at 6 DON!!: exactly -1000 on the chosen opponent Character", () => {
    const engine = ohmAttacking(6);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);
    const bystanderId = engine.findCardInZone("north", "character", op03Namule007);

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Ohm's debuff target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([victimId, bystanderId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");

    // A `thisTurn` modifier is readable straight off the projection, so the magnitude is pinned
    // as an exact number: 6000 - 1000. -2000 would read 4000 and 0 would read 6000. The mutation
    // tool never probes a negative `value:`, so this assertion is the only cover it has.
    expect(powerOf(engine, victimId)).toBe(5000);
    expect(powerOf(engine, bystanderId)).toBe(5000);
  });

  test("[When Attacking] well under the threshold: 3 DON!! still fires", () => {
    // The case that separates `lte 6` from `gte 6`; at exactly 6 both hold.
    const engine = ohmAttacking(3);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");
    expect(powerOf(engine, victimId)).toBe(5000);
  });

  test("[When Attacking] at 7 DON!! the effect never fires", () => {
    const engine = ohmAttacking(7);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    // A leading "If you have ..." gates the whole block, so there is no prompt at all -- not an
    // empty one. Moving the condition onto the action would still publish the target choice.
    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectTargetSelection",
        ),
    ).toBe(false);
    expect(powerOf(engine, victimId)).toBe(6000);
  });
});
