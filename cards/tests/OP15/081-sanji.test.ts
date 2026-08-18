import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import { op01MonkeyDLuffy003, op06GeckoMoria080, op15Sanji081 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op01MonkeyDLuffy003's traits are the single concatenated string "Straw Hat Crew Supernovas",
// so this fixture is what makes `match: "includes"` load-bearing -- under `match: "exact"` the
// leaderTrait check never matches and the first test goes red. Its only ability is an
// [Activate: Main], so it stays out of the way of an [On Play].
function sanjiUnder(leaderCardId: LeaderCard) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op15Sanji081], deck: 20, activeDon: 3 },
    {},
  );
}

describe("OP15-081 Sanji", () => {
  test("under a [Straw Hat Crew] Leader the [On Play] mills exactly 5", () => {
    const engine = sanjiUnder(op01MonkeyDLuffy003);
    const before = engine.getState().players.south;
    const deckBefore = before.deck.length;
    const trashBefore = before.trash.length;

    engine.playCard(op15Sanji081, "south");

    const after = engine.getState().players.south;
    // Exactly 5, hand-pinned: `amount: 5` is a single digit, so mutation_check.py generates no
    // mutant for it and 4 or 6 would otherwise pass unnoticed.
    expect(after.deck).toHaveLength(deckBefore - 5);
    expect(after.trash).toHaveLength(trashBefore + 5);
  });

  test("under a Leader without the type nothing is milled at all", () => {
    // op06GeckoMoria080 is [The Seven Warlords of the Sea Thriller Bark Pirates]. The condition
    // LEADS the printed sentence and there is no cost, so it gates the whole block: no mill.
    const engine = sanjiUnder(op06GeckoMoria080);
    const deckBefore = engine.getState().players.south.deck.length;
    const trashBefore = engine.getState().players.south.trash.length;

    engine.playCard(op15Sanji081, "south");

    const after = engine.getState().players.south;
    expect(after.deck).toHaveLength(deckBefore);
    expect(after.trash).toHaveLength(trashBefore);
  });
});
