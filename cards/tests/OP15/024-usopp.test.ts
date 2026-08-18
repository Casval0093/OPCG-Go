import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02LittleoarsJr020,
  op02Smoker093,
  op03Namule007,
  op05Enel098,
  op05JohnGiant044,
  op15Usopp024,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ACTS = { firstPlayer: "south", activeSeat: "north" } as const;

describe("OP15-024 Usopp", () => {
  test("[Opponent's Turn] the granted [Blocker] is real, and a vanilla body next to it is not", () => {
    // Granted keywords have no projected field (ProjectedCard carries power/cost/rested and no
    // keyword list), so the grant is proved functionally: Usopp appears among the blocker
    // candidates on the opponent's turn and op03Namule007, an identically-active vanilla body on
    // the same board, does not.
    //
    // NOTE the `[Opponent's Turn]` condition itself is not falsifiable in this engine, and no test
    // here claims to cover it: a blocker step only ever opens for the seat being attacked, which
    // is by construction the seat whose opponent's turn it is. Both readings of the condition are
    // therefore green on every reachable board.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [{ card: op15Usopp024 }, { card: op03Namule007 }] },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Kingdew006, playedOnTurn: 0 }],
      },
      NORTH_ACTS,
    );
    const usoppId = engine.findCardInZone("south", "character", op15Usopp024);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a blocker selection.");
    // The candidate list carries a synthetic "skip" entry that is not a card.
    const candidates = blocker.candidates
      .map((candidate) => candidate.ref.id)
      .filter((id) => id !== "skip");
    expect(candidates).toEqual([usoppId]);
    expect(candidates).not.toContain(namuleId);
  });

  test("[On K.O.] rests an opponent Leader or Character with a cost of 7 or less", () => {
    // op02LittleoarsJr020  cost 7 -- exactly on the printed line
    // op05JohnGiant044     cost 8 -- one clear of it
    // the north Leader     baseCost() is 0 for a leader, so it always passes "7 or less"; it is
    //                      also the fixture that kills `comparison lte -> gte`
    // op02Kingdew006       cost 5 but rests when it attacks, and a `rest` action's pool drops
    //                      already-rested cards before its own filters, so it is NOT the
    //                      over-the-line fixture -- John Giant is.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [{ card: op15Usopp024, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [
          { card: op02Kingdew006, playedOnTurn: 0 },
          { card: op02LittleoarsJr020 },
          { card: op05JohnGiant044 },
        ],
      },
      NORTH_ACTS,
    );
    const usoppId = engine.findCardInZone("south", "character", op15Usopp024);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);
    const oarsId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const giantId = engine.findCardInZone("north", "character", op05JohnGiant044);
    const northLeaderId = engine.leader("north");

    engine.declareAttack(attackerId, usoppId, "north");
    expect(engine.getState().cards[usoppId]?.zone).toBe("trash");

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(step?.kind).toBe("selectEntity");
    if (step?.kind !== "selectEntity") throw new Error("Expected a rest target selection.");
    const candidates = step.candidates.map((candidate) => candidate.ref.id);
    expect(candidates.sort()).toEqual([northLeaderId, oarsId].sort());
    expect(candidates).not.toContain(giantId);
    expect(candidates).not.toContain(attackerId);
    expect(step.max).toBe(1);

    // Rest the Leader: `zones: ["leader", "character"]` is printed and this is the half of it a
    // character-only encoding would lose.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [northLeaderId] }, "south");
    expect(engine.getState().cards[northLeaderId]?.rested).toBe(true);
    expect(engine.getState().cards[oarsId]?.rested).toBe(false);
  });

  test("[On K.O.] with only an over-cost opponent body still offers the Leader", () => {
    // The Leader is a candidate on its own, with no legal Character anywhere -- which is what
    // separates "the cost filter excluded the Character" from "the effect never fired".
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [{ card: op15Usopp024, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Kingdew006, playedOnTurn: 0 }, { card: op05JohnGiant044 }],
      },
      NORTH_ACTS,
    );
    const usoppId = engine.findCardInZone("south", "character", op15Usopp024);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);
    const giantId = engine.findCardInZone("north", "character", op05JohnGiant044);

    engine.declareAttack(attackerId, usoppId, "north");

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected a rest target selection.");
    expect(step.candidates.map((candidate) => candidate.ref.id)).toEqual([engine.leader("north")]);
    expect(engine.getState().cards[giantId]?.rested).toBe(false);
  });
});
