import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02EmporioIvankov049,
  op02Kingdew006,
  op04Kuro023,
  op16Mr3Galdino037,
  op16MonkeyDLuffy022,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-037 Mr.3(Galdino)", () => {
  test("under an [Impel Down] Leader, rests an opponent Character of cost exactly 5 or below", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16MonkeyDLuffy022,
        hand: [op16Mr3Galdino037],
        activeDon: op16Mr3Galdino037.cost,
      },
      { character: [op02Atmos003, op02Kingdew006, op04Kuro023] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const cheapId = engine.findCardInZone("north", "character", op02Atmos003); // cost 4
    const onTheLineId = engine.findCardInZone("north", "character", op02Kingdew006); // cost 5
    const overTheLineId = engine.findCardInZone("north", "character", op04Kuro023); // cost 6

    engine.playCard(op16Mr3Galdino037, "south");

    const target = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(target).toMatchObject({ kind: "selectEntity", min: 0, max: 1 });
    if (target?.kind !== "selectEntity") throw new Error("Expected Galdino's rest choice.");
    expect(target.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [cheapId, onTheLineId].sort(),
    );
    expect(target.candidates.map((candidate) => candidate.ref.id)).not.toContain(overTheLineId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [onTheLineId] }, "south");

    expect(engine.getState().cards[onTheLineId]?.rested).toBe(true);
    expect(engine.getState().cards[cheapId]?.rested).toBe(false);
  });

  test("without the [Impel Down] type on your Leader the effect never fires", () => {
    // The default fixture Leader is OP13-001, traits ["Straw Hat Crew Supernovas"].
    const engine = OnePieceTestEngine.create(
      { hand: [op16Mr3Galdino037], activeDon: op16Mr3Galdino037.cost },
      { character: [op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const opponentBodyId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op16Mr3Galdino037, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[opponentBodyId]?.rested).toBe(false);
  });

  test("a Leader whose traits are one concatenated string still counts", () => {
    // op02EmporioIvankov049's traits are ["Revolutionary Army Impel Down"] -- a single string,
    // as older sets store them. This is the case `match: "includes"` exists for; an exact
    // match would find nothing and the effect would silently never fire.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02EmporioIvankov049,
        hand: [op16Mr3Galdino037],
        activeDon: op16Mr3Galdino037.cost,
      },
      { character: [op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const opponentBodyId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op16Mr3Galdino037, "south");

    const target = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (target?.kind !== "selectEntity") throw new Error("Expected Galdino's rest choice.");
    expect(target.candidates.map((candidate) => candidate.ref.id)).toEqual([opponentBodyId]);
  });
});
