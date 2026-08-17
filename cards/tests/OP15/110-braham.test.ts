import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Thatch007,
  op05Enel098,
  op08Kalgara098,
  op15Braham110,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op08Kalgara098 is the only [Shandian Warrior] Leader in the pool, and it stores its traits as
// ONE concatenated string, ["Sky Island Shandian Warrior Jaya"] -- so `match: "includes"` is
// behavioural here, not decoration. op05Enel098 is [Sky Island] but NOT [Shandian Warrior], which
// is what stops the trait being loosened to the broader one.
const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

function brahamKod(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    // South holds no cards: a defender with a non-empty hand opens a battleCounter step first.
    {
      leaderCardId,
      character: [{ card: op15Braham110, rested: true }],
      life: 2,
      deck: [op01Sai012, op01Sai012],
    },
    { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    NORTH_ATTACKS,
  );
}

describe("OP15-110 Braham", () => {
  test("[On K.O.] under a [Shandian Warrior] Leader puts the top deck card on top of Life", () => {
    const engine = brahamKod(op08Kalgara098);
    const brahamId = engine.findCardInZone("south", "character", op15Braham110);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const deckTopId = engine.getState().players.south.deck[0];

    engine.declareAttack(thatchId, brahamId, "north");
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "1" }, "south");

    const state = engine.getState();
    expect(state.cards[brahamId]?.zone).toBe("trash");
    expect(state.players.south.life).toHaveLength(3);
    expect(state.players.south.life[0]).toBe(deckTopId);
    expect(state.players.south.deck).toHaveLength(1);
  });

  test("a [Sky Island] Leader without the [Shandian Warrior] type fires nothing", () => {
    const engine = brahamKod(op05Enel098);
    const brahamId = engine.findCardInZone("south", "character", op15Braham110);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, brahamId, "north");

    // Loosen the trait to "Sky Island" and this goes red -- Enel would qualify.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[brahamId]?.zone).toBe("trash");
    expect(engine.getState().players.south.life).toHaveLength(2);
  });

  test('"up to 1" really allows 0', () => {
    const engine = brahamKod(op08Kalgara098);
    const brahamId = engine.findCardInZone("south", "character", op15Braham110);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, brahamId, "north");
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "0" }, "south");

    expect(engine.getState().players.south.life).toHaveLength(2);
    expect(engine.getState().players.south.deck).toHaveLength(2);
  });
});
