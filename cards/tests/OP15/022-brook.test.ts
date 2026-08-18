import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Genzo046, op03Merry052, op15Brook022 } from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Only the [Activate: Main] half of this Leader is encoded. The deck-out grace period ("you do not
// lose when your deck has 0 cards; you lose at the end of the turn in which it becomes 0") is parked
// for want of a `loseGame` action -- see cards/OP15/leaders/022-brook.ts. Nothing here covers it, and
// in particular no test below asserts anything about losing or not losing the game.
//
// Also NOT covered, deliberately: ruling #879's sub-4-card deck. `trashFromDeck` trashes nothing at
// all when `!upTo` and the deck is shorter than the requested amount, so a 1-3 card deck never
// reaches 0 and the setActive never fires, whereas the ruling says the activation is legal and mills
// the whole remaining deck. That is an engine limitation reported as a finding, not an encoding
// choice, and writing a test for behaviour the engine cannot produce would just be a red test.

function brook(
  deckSize: number,
  characters: PlayerFixture["character"] = [{ card: op03Genzo046, rested: true }],
) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op15Brook022,
      deck: Array.from({ length: deckSize }, () => op03Merry052),
      character: characters,
    },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-022 Brook", () => {
  test("mills exactly 4 and, at an empty deck, sets one of your Characters active", () => {
    const engine = brook(4);
    const genzoId = engine.findCardInZone("south", "character", op03Genzo046);
    expect(engine.getView("south").players.south.characters[0]?.rested).toBe(true);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Brook's setActive choice.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([genzoId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [genzoId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.deckCount).toBe(0);
    expect(view.players.south.trash).toHaveLength(4);
    expect(view.players.south.characters[0]?.rested).toBe(false);
  });

  test("with cards still left after the mill, the setActive half does not fire at all", () => {
    // 6 - 4 = 2 remaining, so the `zoneCount deck eq 0` condition on the second action fails. The
    // assertion is that NO prompt appears, not that an empty one does: change the condition's
    // comparison or value and this goes red.
    const engine = brook(6);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    const view = engine.getView("south");
    expect(view.players.south.deckCount).toBe(2);
    expect(view.players.south.trash).toHaveLength(4);
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.characters[0]?.rested).toBe(true);
  });

  test("the mill is once per turn", () => {
    // Nothing else in this file changes if `oncePerTurn: true` is deleted.
    const engine = brook(12);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    expect(engine.getView("south").players.south.deckCount).toBe(8);
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) =>
          command.type === "activateEffect" && command.sourceId === engine.leader("south"),
      ),
    ).toBe(false);
  });

  test("the setActive is restricted to your OWN Characters", () => {
    // `player: "self"` on the target is the load-bearing part: flip it to "opponent" (or widen it to
    // "any") and this goes red. An opponent's rested Character is the only thing that can catch that,
    // since the printed text is "up to 1 of your Characters".
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Brook022,
        deck: Array.from({ length: 4 }, () => op03Merry052),
        character: [
          { card: op03Genzo046, rested: true },
          // An already-ACTIVE Character of your own stays a legal candidate, and that is correct
          // rather than a gap: the card prints "up to 1 of your Characters" with no rested
          // restriction, and GENERAL ruling #27 makes targeting permissive -- you may choose a target
          // for which the effect does nothing. So this is asserted as present, not filtered out; the
          // encoding deliberately carries no `state: "rested"` filter to invent one.
          { card: op02Atmos003, rested: false },
        ],
      },
      { character: [{ card: op02Atmos003, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const ownRestedId = engine.findCardInZone("south", "character", op03Genzo046);
    const ownActiveId = engine.findCardInZone("south", "character", op02Atmos003);
    const opponentRestedId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Brook's setActive choice.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([ownRestedId, ownActiveId]);
    expect(candidateIds).not.toContain(opponentRestedId);
  });
});
