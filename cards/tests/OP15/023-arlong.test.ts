import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Smoker093,
  op03Namule007,
  op05Enel098,
  op15Arlong023,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// North's Leader does the attacking, which is what makes a rested LEADER a real candidate: the
// printed pool is "your opponent's rested cards", unqualified, so the Leader and the cost area are
// both in it and neither is reachable any other way (there is no fixture field for a rested
// Leader). Arlong is rested so it can be attacked, and both bodies are 5000 power so the attack
// connects.
function arlongKod(northRestedDon = 2) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op05Enel098,
      character: [
        { card: op15Arlong023, rested: true },
        { card: op03Namule007, rested: true },
      ],
      restedDon: 1,
    },
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op02Atmos003, rested: true }, { card: op03Namule007 }],
      activeDon: 2,
      restedDon: northRestedDon,
    },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

function freezeStep(engine: OnePieceTestEngine) {
  const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
  expect(step?.kind).toBe("selectEntity");
  if (step?.kind !== "selectEntity") throw new Error("Expected a freeze target selection.");
  return step;
}

describe("OP15-023 Arlong", () => {
  test("[On K.O.] offers every rested card the opponent has -- Leader, Character and DON!!", () => {
    const engine = arlongKod();
    const arlongId = engine.findCardInZone("south", "character", op15Arlong023);
    const northLeaderId = engine.leader("north");
    const northRestedBody = engine.findCardInZone("north", "character", op02Atmos003);
    const northActiveBody = engine.findCardInZone("north", "character", op03Namule007);
    const southRestedBody = engine.findCardInZone("south", "character", op03Namule007);

    engine.declareAttack(northLeaderId, arlongId, "north");
    expect(engine.getState().cards[arlongId]?.zone).toBe("trash");

    const step = freezeStep(engine);
    const candidates = step.candidates.map((candidate) => candidate.ref.id);
    // The Leader (rested by attacking) and the cost-area DON!! are what make the wide zone list
    // load-bearing: a `zones: ["character"]` encoding would offer only the rested Atmos.
    expect(candidates.sort()).toEqual(
      [northLeaderId, northRestedBody, "rested-don:north:0", "rested-don:north:1"].sort(),
    );
    // `state: "rested"` -- north's active body is excluded, and so is south's own rested body and
    // south's own rested DON!! (`player: "opponent"`).
    expect(candidates).not.toContain(northActiveBody);
    expect(candidates).not.toContain(southRestedBody);
    expect(candidates).not.toContain("rested-don:south:0");
    // "Up to 2". Single-digit amounts are invisible to mutation_check.py, so pin it by hand: with
    // four candidates available the cap is the printed number, not the pool size.
    expect(step.max).toBe(2);
    expect(step.min).toBe(0);
  });

  test("the frozen cards stay rested through the opponent's next Refresh Phase", () => {
    const engine = arlongKod();
    const arlongId = engine.findCardInZone("south", "character", op15Arlong023);
    const northLeaderId = engine.leader("north");
    const northRestedBody = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(northLeaderId, arlongId, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [northLeaderId, "rested-don:north:0"] },
      "south",
    );

    engine.endTurn("north");
    engine.endTurn("south");

    const state = engine.getState();
    // Frozen: still rested after north's Refresh Phase.
    expect(state.cards[northLeaderId]?.rested).toBe(true);
    expect(state.players.north.restedDon).toBe(1);
    // Not frozen: the rested Atmos and the second rested DON!! came back, which is the control that
    // shows the Refresh Phase actually ran.
    expect(state.cards[northRestedBody]?.rested).toBe(false);
  });

  test("with no rested opponent card at all the effect publishes nothing", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [{ card: op15Arlong023, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Atmos003, playedOnTurn: 0 }],
        activeDon: 2,
        restedDon: 0,
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const arlongId = engine.findCardInZone("south", "character", op15Arlong023);
    const attackerId = engine.findCardInZone("north", "character", op02Atmos003);

    // Attacking with the 6000-power Atmos rather than the Leader: the Leader stays active, so
    // after the K.O. the only rested opponent card is the attacker itself...
    engine.declareAttack(attackerId, arlongId, "north");

    // ...which IS offered. This is the paired control for the "publishes nothing" cases above:
    // the attacker rests when it declares, so exactly one candidate exists.
    const candidates = freezeStep(engine).candidates.map((candidate) => candidate.ref.id);
    expect(candidates).toEqual([attackerId]);
    expect(candidates).not.toContain(engine.leader("north"));
  });
});
