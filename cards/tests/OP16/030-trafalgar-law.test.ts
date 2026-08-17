import { describe, expect, test } from "vite-plus/test";
import {
  op01Shinobu043,
  op02Atmos003,
  op02Franky039,
  op02Kingdew006,
  op03Namule007,
  op04Kuro023,
  op16TrafalgarLaw030,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function rested(engine: OnePieceTestEngine, instanceId: string): boolean {
  const card = engine.getState().cards[instanceId];
  if (!card) throw new Error(`No such instance: ${instanceId}`);
  return card.rested;
}

describe("OP16-030 Trafalgar Law", () => {
  test("[On Play] freezes only a RESTED opponent Character, and only that one skips the Refresh Phase", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16TrafalgarLaw030], activeDon: op16TrafalgarLaw030.cost },
      {
        character: [
          { card: op02Kingdew006, rested: true },
          { card: op04Kuro023, rested: true },
          op02Atmos003,
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const frozenId = engine.findCardInZone("north", "character", op02Kingdew006);
    const otherRestedId = engine.findCardInZone("north", "character", op04Kuro023);
    const activeId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op16TrafalgarLaw030, "south");

    const target = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(target).toMatchObject({ kind: "selectEntity", min: 0, max: 1 });
    if (target?.kind !== "selectEntity") throw new Error("Expected Law's freeze choice.");
    expect(target.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [frozenId, otherRestedId].sort(),
    );
    // An ACTIVE Character is what the `state: "rested"` filter has to keep out; the clause has
    // no cost restriction, so a rested body of any cost stays eligible.
    expect(target.candidates.map((candidate) => candidate.ref.id)).not.toContain(activeId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [frozenId] }, "south");

    engine.endTurn("south");
    // North has now had its Refresh Phase: the untouched rested body woke up, the frozen one
    // did not. Asserting both is what distinguishes a freeze from "nothing happened".
    expect(rested(engine, frozenId)).toBe(true);
    expect(rested(engine, otherRestedId)).toBe(false);

    engine.endTurn("north");
    engine.endTurn("south");
    expect(rested(engine, frozenId)).toBe(false);
  });

  test("[End of Your Turn] sets green cost-5-or-less Characters active, and nothing else", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: op01Shinobu043, rested: true }, // green, cost 3
          { card: op02Franky039, rested: true }, // green, cost 5 -- exactly on the line
          { card: op04Kuro023, rested: true }, // green, cost 6 -- one clear of it
          { card: op03Namule007, rested: true }, // red, cost 3 -- right cost, wrong colour
          { card: op16TrafalgarLaw030, rested: true }, // green, cost 8 -- not even itself
        ],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const greenCheapId = engine.findCardInZone("south", "character", op01Shinobu043);
    const greenOnTheLineId = engine.findCardInZone("south", "character", op02Franky039);
    const greenOverTheLineId = engine.findCardInZone("south", "character", op04Kuro023);
    const wrongColourId = engine.findCardInZone("south", "character", op03Namule007);
    const lawId = engine.findCardInZone("south", "character", op16TrafalgarLaw030);

    engine.endTurn("south");

    expect(rested(engine, greenCheapId)).toBe(false);
    expect(rested(engine, greenOnTheLineId)).toBe(false);
    expect(rested(engine, greenOverTheLineId)).toBe(true);
    expect(rested(engine, wrongColourId)).toBe(true);
    expect(rested(engine, lawId)).toBe(true);
    // `amount: "all"` is mandatory and unbounded -- there is nothing to choose.
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
