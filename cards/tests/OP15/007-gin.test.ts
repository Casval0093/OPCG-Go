import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02LandOfWano048,
  op02Smoker093,
  op03Kuro021,
  op11XDrake017,
  op15Gin007,
} from "@tcg/op-cards";

import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op03Kuro021's traits are the single concatenated string "East Blue Black Cat Pirates", which is
// how the older sets store them. That makes `match: "includes"` genuinely load-bearing here rather
// than decoration -- `match: "exact"` would never find "East Blue" in it.
//
// Hand fixtures, each isolating one filter on the `play` action:
//   op02Kingdew006     Character, cost 5 -- EXACTLY on the "cost of 5 or less" line
//   op11XDrake017      Character, cost 6 -- one over
//   op02LandOfWano048  STAGE,     cost 1 -- within the cost line, wrong card category. It has to be
//                                           a Stage and not an Event: candidatesForPlayAction
//                                           pre-filters every `play` pool to stage-or-character
//                                           before any `cardCategory` filter is consulted, so an
//                                           Event fixture would pass whether the filter exists or
//                                           not.
function ginOnPlay(leaderCardId: CardRef) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op15Gin007, op02Kingdew006, op11XDrake017, op02LandOfWano048],
      activeDon: 6,
    },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-007 Gin", () => {
  test("[On Play] with an [East Blue] Leader offers only cost-5-or-less Character cards", () => {
    const engine = ginOnPlay(op03Kuro021);
    const kingdewId = engine.findCardInZone("south", "hand", op02Kingdew006);

    engine.playCard(op15Gin007, "south");

    const selection = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Gin's play selection.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([kingdewId]);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [kingdewId] }, "south");

    // Actually played, not just offered -- and free, since the effect is what plays it.
    expect(engine.findCardInZone("south", "character", op02Kingdew006)).toBe(kingdewId);
  });

  test("with a Leader lacking the [East Blue] type nothing is offered", () => {
    // No mutation operator touches `conditions`, so the Leader gate is pinned by hand.
    const engine = ginOnPlay(op02Smoker093);

    engine.playCard(op15Gin007, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "hand", op02Kingdew006)).toBeTruthy();
  });

  test('"up to 1" may be declined', () => {
    const engine = ginOnPlay(op03Kuro021);

    engine.playCard(op15Gin007, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "hand", op02Kingdew006)).toBeTruthy();
  });
});
