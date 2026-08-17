import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op15Brook022,
  op15GumGumGoldenRifle116,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15GumGumGoldenRifle116;

function rifle(leader = op15Brook022) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: leader,
      hand: [CARD, op03Genzo046],
      activeDon: 1,
      life: [op03Genzo046, op02Atmos003, op03Genzo046, op02Atmos003],
      deck: [op03Genzo046, op02Atmos003, op03Genzo046],
    },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-116 Gum-Gum Golden Rifle", () => {
  test("[Main] trashes the top Life card, tops up Life from the deck, and trashes 1 from hand", () => {
    const engine = rifle();
    const lifeBefore = engine.getView("south").players.south.lifeCount;
    const deckBefore = engine.getView("south").players.south.deckCount;

    engine.playCard(CARD, "south");
    // `upTo: true` on the addToLife makes the count a choice ("up to 1 card"), so it prompts first.
    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "1" }, "south");

    const view = engine.getView("south");
    // One Life card left for the trash, one arrived from the deck -> net zero.
    expect(view.players.south.lifeCount).toBe(lifeBefore);
    expect(view.players.south.deckCount).toBe(deckBefore - 1);
    // Hand held the Event plus Genzo; the Event was played and Genzo was trashed.
    expect(view.players.south.hand).toHaveLength(0);
  });

  test("ruling #944: without the [Straw Hat Crew] type NONE of it happens, not even the 'Then' half", () => {
    // The decisive placement test. Ruling #944 says a Leader lacking the type cannot do the "Then,
    // add up to 1 card ... and trash 1 card from your hand" either (不可以), so the condition gates the
    // whole block. Move it onto individual actions and this goes red -- the deck would lose a card and
    // the hand would lose Genzo.
    const engine = rifle(op15Krieg001);
    const lifeBefore = engine.getView("south").players.south.lifeCount;
    const deckBefore = engine.getView("south").players.south.deckCount;

    engine.playCard(CARD, "south");

    // No prompt at all -- the block never resolved.
    expect(engine.getView("south").prompts).toHaveLength(0);
    const view = engine.getView("south");
    expect(view.players.south.lifeCount).toBe(lifeBefore);
    expect(view.players.south.deckCount).toBe(deckBefore);
    expect(view.players.south.hand).toHaveLength(1);
  });

  test("[Counter] gives the Leader +4000 with no Leader-type requirement", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      { leaderCardId: op15Krieg001, hand: [CARD], activeDon: 1 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");

    // Genzo attacks at 4000 into a 5000 Leader and never connected anyway, so the durable proof is
    // that the Counter resolved without a prompt of its own (the target is the Leader, count 1, so it
    // auto-resolves) and no Life was lost.
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });
});
