import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op03Namule007, op15Cabaji005 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Cabaji is 3000 and both Leaders print 5000, so the +2000 is exactly the difference between an
// attack that connects and one that does not (`attackPower >= defensePower` is a hit). That makes
// the MAGNITUDE decide a Life card rather than merely being read off a projection: mutate the
// encoding to +1000 and 4000 < 5000, no damage, red. `op02Smoker093` is an inert Leader on both
// sides (its only ability is an [Activate: Main]), so nothing else moves.
function cabajiTurn(giveDonTo: "north" | "south" | "nobody") {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op15Cabaji005, playedOnTurn: 0 }, op03Namule007],
      activeDon: 4,
    },
    { leaderCardId: op02Smoker093, character: [op03Namule007], activeDon: 4 },
    { firstPlayer: "north", activeSeat: "north" },
  );

  // A seat can only attach DON!! to its own cards, so each side does its own giving on its own
  // turn. North's attachment survives into south's turn: resetStartOfTurnState returns attached
  // DON!! at the start of its OWN controller's turn, not the opponent's.
  if (giveDonTo === "north") {
    engine.attachDon(engine.findCardInZone("north", "character", op03Namule007), 1, "north");
  }
  engine.endTurn("north");
  if (giveDonTo === "south") {
    engine.attachDon(engine.findCardInZone("south", "character", op03Namule007), 1, "south");
  }
  return engine;
}

describe("OP15-005 Cabaji", () => {
  test("[When Attacking] with DON!! given on the opponent's side, +2000 turns a failed attack into a hit", () => {
    const engine = cabajiTurn("north");
    const cabajiId = engine.findCardInZone("south", "character", op15Cabaji005);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(cabajiId, engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("with no DON!! given anywhere the attack does not connect", () => {
    const engine = cabajiTurn("nobody");
    const cabajiId = engine.findCardInZone("south", "character", op15Cabaji005);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(cabajiId, engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });

  test('`player: "opponent"` is load-bearing: DON!! given to YOUR own card does not switch it on', () => {
    // North gives a DON!! to SOUTH's Namule -- so DON!! has been given, but on the wrong side of
    // the table. Swap the condition to `player: "self"` (or drop it) and this goes red.
    const engine = cabajiTurn("south");
    const cabajiId = engine.findCardInZone("south", "character", op15Cabaji005);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(cabajiId, engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });
});
