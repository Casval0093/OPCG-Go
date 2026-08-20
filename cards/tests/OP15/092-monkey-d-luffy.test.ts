import { describe, expect, test } from "vite-plus/test";
import { op03Namule007, op06GeckoMoria080, op15MonkeyDLuffy092 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Three independent thresholds over the trash, all cumulative once passed (ruling #927,
// 三条效果全部适用). op06GeckoMoria080 is a 5000-power Leader whose own ability is a
// [DON!!x1] [When Attacking] trigger, so it stays power-inert on a board with no DON!! and no
// attack -- which matters here because bullet 2 targets the Leader.
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

// Bullet 2 is gated on the OPPONENT's turn as well as on the trash count, so it needs its own
// fixture. Both readings are returned together: the Leader is what bullet 2 moves, and the
// Character is here to show bullets 1 and 3 do NOT pick up bullet 2's turn gate.
function onOpponentTurnWithTrash(trash: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op06GeckoMoria080,
      // op03Namule007 is a vanilla 5000 body and it is load-bearing: bullet 2's target is
      // `zones: ["leader"]`, and NARROWING that is caught by the leader assertions while WIDENING
      // it to include characters was not. getPermanentSetBasePower returns the FIRST match, and
      // bullet 1 (self, 9000) is the earlier block, so a widened bullet 2 would be masked on Luffy
      // itself. A second, non-Luffy body is the only thing that sees it.
      character: [op15MonkeyDLuffy092, op03Namule007],
      trash,
      deck: 10,
    },
    {},
    { firstPlayer: "south", activeSeat: "north" },
  );
  const view = engine.getView("south");
  const luffyId = engine.findCardInZone("south", "character", op15MonkeyDLuffy092);
  const namuleId = engine.findCardInZone("south", "character", op03Namule007);
  return {
    leader: view.players.south.leader.power,
    character: view.players.south.characters.find((c) => c?.instanceId === luffyId)?.power,
    bystander: view.players.south.characters.find((c) => c?.instanceId === namuleId)?.power,
  };
}

describe("OP15-092 Monkey.D.Luffy", () => {
  test("at 9 cards in the trash neither threshold has been crossed", () => {
    // The negative control for BOTH blocks at once, and the only thing that kills either
    // `comparison gte -> lte` mutant: under `lte 10` the cost and the base power would jump here,
    // and under `lte 30` the +1000 would.
    expect(luffyWithTrash(9)).toEqual({ power: 7000, cost: 7 });
  });

  test("at exactly 10 cards in the trash the base power becomes 9000 and the cost +10", () => {
    // 10 is ON the line, and `value: 10` is two digits so mutation_check.py generates no mutant
    // for it -- 9-vs-10 here is the whole of the threshold's coverage.
    // Cost 7 printed + 10 = 17; power 7000 printed, REPLACED by the literal 9000. The exact 9000
    // is what kills `value: 9000 -> 8000`.
    expect(luffyWithTrash(10)).toEqual({ power: 9000, cost: 17 });
  });

  test("at 29 cards the +1000 has still not switched on", () => {
    expect(luffyWithTrash(29)).toEqual({ power: 9000, cost: 17 });
  });

  test("at exactly 30 cards all three bullets apply together -- ruling #927", () => {
    // 三条效果全部适用: the bullets are independent thresholds, not exclusive tiers. So bullet 1's
    // base 9000 and bullet 3's +1000 must STACK to 10000, alongside bullet 1's cost bonus.
    //
    // This is the assertion that makes `setBasePower` load-bearing rather than a stylistic choice.
    // `setPower` sets TOTAL power by subtracting getCardPower at resolution, so it would clamp
    // this back to 9000; a bare `modifyPower: +2000` would read 10000 here but would be wrong at
    // every other printed base. Only a base-power REPLACEMENT gives 9000 alone at 10 cards and
    // 10000 at 30.
    expect(luffyWithTrash(30)).toEqual({ power: 10000, cost: 17 });
  });

  test("at 19 cards the Leader clause has not switched on, even on the opponent's turn", () => {
    // The negative control for bullet 2's own threshold, and what kills its
    // `comparison gte -> lte`: under `lte 20` this fires and the Leader reads 7000.
    // The Character is 9000 here, not 7000: bullet 1 crossed at 10 cards and stays on.
    expect(onOpponentTurnWithTrash(19)).toEqual({ leader: 5000, character: 9000, bystander: 5000 });
  });

  test("at exactly 20 cards the Leader's base power becomes 7000 on the opponent's turn", () => {
    // 5000 printed -> 7000. The exact number kills `value: 7000 -> 6000`, which would otherwise
    // read as a plausible +1000 on a 5000 Leader.
    expect(onOpponentTurnWithTrash(20)).toEqual({ leader: 7000, character: 9000, bystander: 5000 });
  });

  test("at 30 cards the Leader clause is still on and the other two bullets keep their turn-blindness", () => {
    // The other half of bullet 2's `gte` coverage: under `lte 20` the Leader falls back to 5000
    // here. And the Character reads 10000 on the OPPONENT's turn too, which is what shows the
    // turn gate belongs to bullet 2 alone rather than to the whole card.
    expect(onOpponentTurnWithTrash(30)).toEqual({ leader: 7000, character: 10000, bystander: 5000 });
  });

  test("on YOUR own turn the Leader clause is off however full the trash is", () => {
    // `condition: "turn"` has no mutation operator, so this is the only thing separating
    // "during your opponent's turn" from "always".
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op06GeckoMoria080, character: [op15MonkeyDLuffy092], trash: 30, deck: 10 },
      {},
    );
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });
});
