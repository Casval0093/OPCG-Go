import { describe, expect, test } from "vite-plus/test";
import { op02Blugori084, op02Sphinx088, op03Namule007, op16MonkeyDLuffy022 } from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Fixtures are all genuinely vanilla pre-OP15 engine cards, so nothing but this Leader's own
// condition can decide whether the activation is offered:
//   op02Blugori084  "Animal Impel Down", cost 1, 3000
//   op02Sphinx088   "Animal Impel Down", cost 4, 6000
//   op03Namule007   "Fish-Man Whitebeard Pirates" -- the non-Impel-Down body
//
// `match: "includes"` is substring matching per trait string (matchesTargetFilter), which is what
// lets "Impel Down" reach these older cards whose traits are one concatenated string.

function luffyWith(characters: PlayerFixture["character"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op16MonkeyDLuffy022, character: characters, activeDon: 0, restedDon: 3 },
    {},
  );
}

function canActivate(engine: OnePieceTestEngine) {
  return getLegalCommands(engine.getState(), "south").some(
    (command) => command.type === "activateEffect" && command.sourceId === engine.leader("south"),
  );
}

describe("OP16-022 Monkey.D.Luffy", () => {
  test("ruling #976: with ZERO Characters the activation is not available", () => {
    // The test this encoding exists for. English reads the other way -- an empty character area
    // trivially satisfies "the only Characters on your field are [Impel Down] type" -- and the
    // shape EB02-010 Monkey.D.Luffy uses for this same phrasing (a lone `zoneCount ... eq 0` over
    // non-matching traits) therefore fires here. #976 says it must not (不能). Delete the
    // unfiltered `gte 1` condition and this goes red.
    const engine = luffyWith([]);

    expect(canActivate(engine)).toBe(false);
    engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: engine.leader("south"),
      trigger: "activateMain",
    });
  });

  test("with two Impel Down Characters, sets up to 2 rested DON!! as active", () => {
    // Two bodies, not one: at exactly 1 Character the `gte 1` condition is indistinguishable from
    // `lte 1`, and the comparison is one of the things mutation_check.py flips.
    const engine = luffyWith([op02Blugori084, op02Sphinx088]);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");
    // An `upTo` DON!! activation asks for a count first: intent `effectSetActiveDon`, a
    // chooseOption step whose option ids are the numbers "0".."max".
    const count = engine.pendingDecision("effectSetActiveDon", "south").steps[0];
    expect(count?.kind).toBe("chooseOption");
    if (count?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // Capped at 2 by the printed "up to 2", not at 3 by the rested DON!! available.
    expect(count.options.map((option) => option.id)).toEqual(["0", "1", "2"]);
    engine.resolveDecision("effectSetActiveDon", { optionId: "2" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.activeDon).toBe(2);
    expect(view.players.south.restedDon).toBe(1);
  });

  test("a single non-Impel-Down Character of your own switches the activation off", () => {
    const engine = luffyWith([op02Blugori084, op02Sphinx088, op03Namule007]);

    expect(canActivate(engine)).toBe(false);
  });

  test("[Once Per Turn]: a second activation in the same turn is not offered", () => {
    const engine = luffyWith([op02Blugori084, op02Sphinx088]);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");
    engine.resolveDecision("effectSetActiveDon", { optionId: "1" }, "south");

    // There is still a rested DON!! left, so nothing but `oncePerTurn: true` is stopping this.
    expect(engine.getView("south").players.south.restedDon).toBe(2);
    expect(canActivate(engine)).toBe(false);
  });
});
