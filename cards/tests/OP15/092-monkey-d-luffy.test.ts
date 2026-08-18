import { describe, expect, test } from "vite-plus/test";
import { op06GeckoMoria080, op15MonkeyDLuffy092 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Two of this card's three printed bullets are PARKED on `setBasePowerLiteral` (see the card's
// own comment and data/parked-clauses.json), so the numbers asserted here are 7000/8000 -- the
// printed base plus the encoded modifiers -- not the 9000/10000 a fully-encoded card would show.
// Ruling #927 (at 30 cards in the trash all three bullets apply) is what makes those two clauses
// unencodable rather than merely awkward: bullet 1 and bullet 3 must STACK, and `setPower` is a
// total-power set that would clamp them.
function luffyWithTrash(trash: number) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: op06GeckoMoria080, character: [op15MonkeyDLuffy092], trash, deck: 10 },
    {},
  );
  const view = engine.getView("south");
  const luffy = view.players.south.characters.find((card) => card !== null);
  if (!luffy || luffy.power === null || luffy.cost === null) {
    throw new Error("Luffy was not projected with a power and cost.");
  }
  return { power: luffy.power, cost: luffy.cost };
}

describe("OP15-092 Monkey.D.Luffy", () => {
  test("at 9 cards in the trash neither threshold has been crossed", () => {
    // The negative control for BOTH blocks at once, and the only thing that kills either
    // `comparison gte -> lte` mutant: under `lte 10` the cost would jump here, and under
    // `lte 30` the power would.
    expect(luffyWithTrash(9)).toEqual({ power: 7000, cost: 7 });
  });

  test("at exactly 10 cards in the trash it gains +10 cost and nothing else", () => {
    // 10 is ON the line, and `value: 10` is two digits so mutation_check.py generates no mutant
    // for it -- 9-vs-10 here is the whole of the threshold's coverage.
    // Cost 7 printed + 10 = 17. The base-power half of this same bullet is parked, which is why
    // the power is still 7000 rather than 9000.
    expect(luffyWithTrash(10)).toEqual({ power: 7000, cost: 17 });
  });

  test("at 29 cards the +1000 has still not switched on", () => {
    expect(luffyWithTrash(29)).toEqual({ power: 7000, cost: 17 });
  });

  test("at exactly 30 cards both encoded bullets apply together -- ruling #927", () => {
    // 三条效果全部适用: the bullets are independent thresholds, not exclusive tiers, so the
    // cost bonus from the 10-card bullet is still there alongside the 30-card power bonus.
    // Two separate `permanentEffects` blocks is what expresses that; one block with two actions
    // would tie the +1000 to the 10-card threshold.
    expect(luffyWithTrash(30)).toEqual({ power: 8000, cost: 17 });
  });
});
