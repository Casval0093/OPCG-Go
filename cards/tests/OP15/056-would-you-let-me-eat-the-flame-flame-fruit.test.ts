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

  test("ruling #899: a non-Lucy Leader's connecting attack takes only 1 Life", () => {
    // The power assertion on the existing non-Lucy case cannot see `delete condition:leaderName`
    // on `grantKeyword` -- that mutant still leaves the Leader at 5000. Without [Double Attack]
    // a connecting 5000-vs-5000 Leader attack is 1 Life.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, hand: [CARD], activeDon: 7, deck: DECK },
      { life: [op03Genzo046, op02Atmos003, op03Genzo046, op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("[Trigger] draws 2 cards to self", () => {
    // No prior test reached the Trigger block, so `amount 2->1` and `player self->opponent`
    // there were free. Activating sends the card to the trash rather than the hand (GENERAL
    // #21 is the other fork: decline and add to hand). The two cards in hand are the draw,
    // and the opponent's hand stays empty.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Lucy002,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: DECK,
      },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(2);
    expect(engine.getView("north").players.north.hand).toHaveLength(0);
    expect(engine.findCardInZone("south", "trash", CARD)).toBeTruthy();
  });
});
