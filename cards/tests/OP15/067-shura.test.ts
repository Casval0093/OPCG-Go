import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op15Shura067, op16PortgasDAce001 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// south is second, so it may attack on its own first turn -- otherwise "cannot attack" would be
// true for a reason that has nothing to do with [Rush].
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// Shura is played from HAND every time: [Rush] is only observable on a body that was played this
// turn, so a `character:` fixture would make every one of these tests vacuous.
function playShura(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      hand: [op15Shura067],
      deck: [op03Namule007, op02Atmos003],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    { leaderCardId: op16PortgasDAce001 },
    SOUTH_ATTACKS,
  );
  engine.playCard(op15Shura067, "south");
  // Decline the [On Play] DON!! -1: paying it would drop the field count by one and quietly
  // move the very threshold under test.
  engine.resolveDecision("effectOptional", { optionId: "no" }, "south");
  return engine;
}

describe("OP15-067 Shura", () => {
  test("[On Play] DON!! -1: paying returns a DON!! to the DON!! deck and draws exactly 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Shura067],
        deck: [op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const topId = engine.getState().players.south.deck[0];

    engine.playCard(op15Shura067, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 9 });
    expect(state.players.south.hand).toEqual([topId]);
  });

  test("at 6 DON!! Shura attacks the turn he is played", () => {
    // Granted keywords have no projected field, so [Rush] is proven functionally.
    const engine = playShura(6);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op15Shura067),
      engine.leader("north"),
      "south",
    );
    expect(engine.getState().players.south.characterArea.filter(Boolean)).toHaveLength(1);
  });

  test("well under the threshold: at 3 DON!! he still has [Rush]", () => {
    // Separates `lte 6` from `gte 6`; at exactly 6 both comparisons hold.
    const engine = playShura(3);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op15Shura067),
      engine.leader("north"),
      "south",
    );
    expect(engine.getState().players.south.characterArea.filter(Boolean)).toHaveLength(1);
  });

  test("at 7 DON!! he cannot attack the turn he is played", () => {
    // The control that makes the two tests above mean something: without the grant the attack
    // is rejected outright, with a quotable reason.
    const engine = playShura(7);

    const rejected = engine.expectFailure({
      type: "declareAttack",
      seat: "south",
      attackerId: engine.findCardInZone("south", "character", op15Shura067),
      targetId: engine.leader("north"),
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toBe("The selected attacker cannot attack.");
  });
});
