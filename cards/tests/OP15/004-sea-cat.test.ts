import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import { op02Atmos003, op02Smoker093, op03Namule007, op15SeaCat004 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// GENERAL ruling #4: a card whose power drops to 0 or less STAYS on the field, so a Leader really
// can sit at 0-or-less power. Nothing in OP01-OP14 debuffs your own Leader that far on demand, so
// the state is reached directly: a synthetic Leader spread from an inert real one with `power: 0`.
// The negative fixture below is the SAME card at its printed 5000, which makes the Leader's power
// the only variable between the two tests.
const zeroPowerLeader: LeaderCard = {
  ...op02Smoker093,
  id: "TEST-OP15-004-ZERO-POWER-LEADER",
  canonicalId: "TEST-OP15-004-ZERO-POWER-LEADER",
  power: 0,
};

registerCards([zeroPowerLeader]);

describe("OP15-004 Sea Cat", () => {
  test("with a 0-power Leader, [On Play] debuffs exactly one opponent Character by exactly 3000", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: zeroPowerLeader,
        hand: [op15SeaCat004],
        character: [op03Namule007],
        activeDon: 3,
      },
      { character: [op02Atmos003, op03Namule007] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const theirAtmosId = engine.findCardInZone("north", "character", op02Atmos003);
    const myNamuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(op15SeaCat004, "south");

    // `player: "opponent"` is load-bearing: south's own Namule must not be selectable.
    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Sea Cat's debuff target.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toContain(theirAtmosId);
    expect(candidateIds).not.toContain(myNamuleId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [theirAtmosId] }, "south");

    // The magnitude, not just the recipient. `value: -3000` is a NEGATIVE number, which
    // mutation_check.py's numeric operator cannot see (`value:\s*(\d{3,6})` never matches a minus
    // sign), so this is hand-pinned: Atmos prints 6000 and must read exactly 3000, not 4000/5000.
    // A `thisTurn` modifier is readable straight off the projection, unlike `thisBattle`.
    const view = engine.getView("south");
    const atmos = view.players.north.characters.find((card) => card?.instanceId === theirAtmosId);
    expect(atmos?.power).toBe(3000);
    // ... and it really is only "up to 1": the untouched opponent Namule is unchanged.
    const theirNamule = view.players.north.characters.find(
      (card) => card?.instanceId !== theirAtmosId,
    );
    expect(theirNamule?.power).toBe(5000);
  });

  test("the debuff expires at end of turn", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: zeroPowerLeader, hand: [op15SeaCat004], activeDon: 3 },
      { character: [op02Atmos003, op03Namule007] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const theirAtmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op15SeaCat004, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [theirAtmosId] }, "south");
    engine.endTurn("south");

    const atmos = engine
      .getView("north")
      .players.north.characters.find((card) => card?.instanceId === theirAtmosId);
    expect(atmos?.power).toBe(6000);
  });

  test("with a normal 5000-power Leader nothing happens at all", () => {
    // The same fixture with the Leader at its printed power. This is what kills both mutations of
    // the gate: `comparison: "lte" -> "gte"` (every 5000 Leader would satisfy `power gte 0`) and
    // `delete filter:power` (an unfiltered `hasCard` over `zone: "leader"` always matches).
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, hand: [op15SeaCat004], activeDon: 3 },
      { character: [op02Atmos003, op03Namule007] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const theirAtmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op15SeaCat004, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(
      view.players.north.characters.find((card) => card?.instanceId === theirAtmosId)?.power,
    ).toBe(6000);
  });
});
