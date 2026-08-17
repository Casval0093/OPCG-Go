import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op05Enel098, op15MonkeyDLuffy119 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// `donFieldCount` counts DON!! wherever they sit -- active, rested and attached alike -- so paying
// Luffy's own cost of 5 does not change the total. `value: 6` is a single digit and therefore
// invisible to `mutation_check.py`'s numeric operator; the 5/6/7 ladder below is what pins it.
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function luffyPlayedWithDon(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15MonkeyDLuffy119], activeDon },
    { life: [op01Sai012, op01Sai012, op01Sai012] },
    SOUTH_ACTS,
  );
  engine.playCard(op15MonkeyDLuffy119, "south");
  return engine;
}

function luffyAttack(engine: OnePieceTestEngine) {
  return {
    type: "declareAttack",
    seat: "south",
    attackerId: engine.findCardInZone("south", "character", op15MonkeyDLuffy119),
    targetId: engine.leader("north"),
  } as const;
}

describe("OP15-119 Monkey.D.Luffy", () => {
  test("at exactly 6 DON!! on the field it gains [Rush] and can attack the turn it is played", () => {
    const engine = luffyPlayedWithDon(6);

    expect(engine.exec(luffyAttack(engine)).accepted).toBe(true);
  });

  test("at 5 DON!! it does not -- exactly one under the line", () => {
    const engine = luffyPlayedWithDon(5);

    expect(engine.expectFailure(luffyAttack(engine)).reason).toBe(
      "The selected attacker cannot attack.",
    );
  });

  test("at 7 DON!! it still does -- the comparison is `gte`, not `eq`", () => {
    const engine = luffyPlayedWithDon(7);

    expect(engine.exec(luffyAttack(engine)).accepted).toBe(true);
  });

  test("the DON!! count is your own field, not the opponent's", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15MonkeyDLuffy119], activeDon: 5 },
      { activeDon: 10, life: [op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ACTS,
    );
    engine.playCard(op15MonkeyDLuffy119, "south");

    expect(engine.expectFailure(luffyAttack(engine)).reason).toBe(
      "The selected attacker cannot attack.",
    );
  });

  test("DON!! on your field means anywhere on it -- rested and attached DON!! count too", () => {
    // Pay the cost (resting 5) and attach the remaining 6 to the Leader, leaving ZERO active
    // DON!!. `donFieldCount` counts all three states, so the grant still holds -- which is the
    // assertion that would go red if the condition were `activeDonCount` instead.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15MonkeyDLuffy119], activeDon: 11 },
      { life: [op01Sai012, op01Sai012, op01Sai012] },
      SOUTH_ACTS,
    );
    engine.playCard(op15MonkeyDLuffy119, "south");
    engine.attachDon(engine.leader("south"), 6, "south");

    expect(engine.getState().players.south.activeDon).toBe(0);
    expect(engine.exec(luffyAttack(engine)).accepted).toBe(true);
  });
});
