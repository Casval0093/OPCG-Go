import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import { op02Smoker093, op02Thatch007, op15Pincers013 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// GENERAL ruling #4: a card whose power drops to 0 or less stays on the field, so a 0-power Leader
// is a reachable state. The synthetic below and op02Smoker093 are the same card apart from `power`,
// which makes the Leader's power the only variable between the two halves of every test here.
const zeroPowerLeader: LeaderCard = {
  ...op02Smoker093,
  id: "TEST-OP15-013-ZERO-POWER-LEADER",
  canonicalId: "TEST-OP15-013-ZERO-POWER-LEADER",
  power: 0,
};

registerCards([zeroPowerLeader]);

function pincersInHand(leaderCardId: CardRef, don: number) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op15Pincers013], activeDon: don },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function handCost(engine: OnePieceTestEngine) {
  const pincersId = engine.findCardInZone("south", "hand", op15Pincers013);
  return engine.getView("south").players.south.hand.find((card) => card?.instanceId === pincersId)
    ?.cost;
}

describe("OP15-013 Pincers", () => {
  test("with a 0-power Leader the hand cost is exactly 2, not 3 and not 1", () => {
    // Printed cost 4. `value: -2` is negative AND single-digit, so mutation_check.py generates
    // nothing for it; reading the projected cost back is what pins the magnitude by hand.
    expect(handCost(pincersInHand(zeroPowerLeader, 4))).toBe(2);
  });

  test("with a normal 5000-power Leader the printed cost 4 stands", () => {
    // Kills both `comparison: "lte" -> "gte"` (a 5000 Leader satisfies `power gte 0`) and
    // `delete filter:power` (an unfiltered `hasCard` over `zone: "leader"` always matches).
    expect(handCost(pincersInHand(op02Smoker093, 4))).toBe(4);
  });

  test("the discount is real at the till: 2 DON!! is enough, and pays all of it", () => {
    const engine = pincersInHand(zeroPowerLeader, 2);

    engine.playCard(op15Pincers013, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op15Pincers013)).toBeTruthy();
    // Paying rests the DON!!, so a cost of 2 leaves 0 active and 2 rested. A -1 discount would
    // have made the play illegal; a -3 discount would leave 1 active and 1 rested.
    expect(view.players.south.activeDon).toBe(0);
    expect(view.players.south.restedDon).toBe(2);
  });

  test("without the discount 2 DON!! is not enough", () => {
    const engine = pincersInHand(op02Smoker093, 2);

    const rejection = engine.expectFailure({
      type: "playCard",
      seat: "south",
      instanceId: engine.findCardInZone("south", "hand", op15Pincers013),
    });
    expect(rejection.reason).toBe("Not enough active DON!! to pay the cost.");
  });

  test("the printed [Blocker] works", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Pincers013] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const pincersId = engine.findCardInZone("south", "character", op15Pincers013);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([pincersId]);
  });
});
