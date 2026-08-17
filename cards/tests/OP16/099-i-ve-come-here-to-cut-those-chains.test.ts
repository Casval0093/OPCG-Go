import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Fukurokuju110,
  op01Otsuru036,
  op01Urashima092,
  op02Kingdew006,
  op02LandOfWano048,
  op03Namule007,
  op16IVeComeHereToCutThoseChains099,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The pre-seeded trash pins all three play filters, each from the side that can actually fail:
//   op01Otsuru036      Land of Wano character, cost 1  -- clear of the cost line
//   op01Fukurokuju110  Land of Wano character, cost 6  -- ON the line; the only fixture pinning 6
//   op01Urashima092    Land of Wano character, cost 7  -- excluded by the cost filter
//   op02LandOfWano048  Land of Wano STAGE,     cost 1  -- excluded by cardCategory, and reachable
//                                                         without it because candidatesForPlayAction
//                                                         admits stages (cards/ENCODING.md)
//   op03Namule007      Whitebeard character,   cost 3  -- excluded by the trait filter
// The five cards milled off the deck are all eb01Doma005 (Whitebeard Pirates Allies), so the mill
// cannot quietly add a legal candidate and confuse the assertion.

describe("OP16-099 I've Come Here... To Cut Those Chains!!!", () => {
  test("[Main] mills 5, then plays a Land of Wano Character of cost 6 or less from the trash", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16IVeComeHereToCutThoseChains099],
        deck: [eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
        trash: [
          op01Otsuru036,
          op01Fukurokuju110,
          op01Urashima092,
          op02LandOfWano048,
          op03Namule007,
        ],
        // 1 for the event, 6 for the cost.
        activeDon: 7,
      },
      {},
    );
    const otsuruId = engine.findCardInZone("south", "trash", op01Otsuru036);
    const fukurokujuId = engine.findCardInZone("south", "trash", op01Fukurokuju110);
    const urashimaId = engine.findCardInZone("south", "trash", op01Urashima092);
    const wanoStageId = engine.findCardInZone("south", "trash", op02LandOfWano048);
    const namuleId = engine.findCardInZone("south", "trash", op03Namule007);

    engine.playCard(op16IVeComeHereToCutThoseChains099, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // 6 deck cards minus 5 milled leaves 1.
    expect(engine.getState().players.south.deck).toHaveLength(1);

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (play?.kind !== "selectEntity") throw new Error("Expected the play-from-trash offer.");
    expect(play.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [otsuruId, fukurokujuId].sort(),
    );
    for (const excluded of [urashimaId, wanoStageId, namuleId]) {
      expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(excluded);
    }
    engine.resolveDecision("effectPlaySelection", { selectedIds: [fukurokujuId] }, "south");

    const state = engine.getState();
    expect(state.players.south.characterArea.filter(Boolean)).toEqual([fukurokujuId]);
    expect(state.players.south.activeDon).toBe(0);
    expect(state.players.south.restedDon).toBe(7);
  });

  test("[Counter] +3000 holds a 7000-power attack off the Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16IVeComeHereToCutThoseChains099, eb01Doma005],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const eventId = engine.findCardInZone("north", "hand", op16IVeComeHereToCutThoseChains099);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    // 5000 + 3000 = 8000 beats the 7000 attacker; +2000 would tie at 7000 and let it through.
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });
});
