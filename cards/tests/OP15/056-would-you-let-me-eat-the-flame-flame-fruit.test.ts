import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op15Krieg001,
  op15Lucy002,
  op15WouldYouLetMeEatTheFlameFlameFruit056,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15WouldYouLetMeEatTheFlameFlameFruit056;
const DECK = [op03Genzo046, op02Atmos003, op03Genzo046, op02Atmos003];

describe("OP15-056 Would You Let Me Eat the Flame-Flame Fruit?", () => {
  test("[Main] with a [Lucy] Leader draws 2 and gives the Leader +3000", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Lucy002, hand: [CARD], activeDon: 7, deck: DECK },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.leader.power).toBe(8000);
  });

  test("ruling #899: a non-Lucy Leader still draws 2, but gets no power and no [Double Attack]", () => {
    // The decisive placement test. The [Lucy] check sits on the two later actions, not on the block:
    // move it up to `conditions` and the draw disappears too, so this goes red at 0 cards drawn.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, hand: [CARD], activeDon: 7, deck: DECK },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.leader.power).toBe(5000);
  });

  test("[Double Attack] is really granted -- a connecting Leader attack takes 2 Life", () => {
    // Proves the keyword functionally rather than by reading a projected field.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Lucy002, hand: [CARD], activeDon: 7, deck: DECK },
      { life: [op03Genzo046, op02Atmos003, op03Genzo046, op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");

    // Lucy at 8000 beats north's 5000 Leader, and [Double Attack] makes it 2 Life rather than 1.
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 2);
  });
});
