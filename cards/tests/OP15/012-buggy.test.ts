import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op02Thatch007, op15Buggy012 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [On K.O.] is encoded. The [When Attacking] "give up to 1 rested DON!! card to its
// owner's Leader or 1 of their Characters" is parked -- see the card file: `giveDon` always sources
// the DON!! from the effect controller's own cost area, and rulings #865/#868 require the source to
// follow the chosen target's controller instead.

describe("OP15-012 Buggy", () => {
  test("[On K.O.] draws exactly 1 card, off the deck", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [{ card: op15Buggy012, rested: true }], deck: 10 },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const buggyId = engine.findCardInZone("south", "character", op15Buggy012);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const before = engine.getView("south").players.south;
    expect(before.hand).toHaveLength(0);

    // Thatch 8000 vs Buggy 4000.
    engine.declareAttack(thatchId, buggyId, "north");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(buggyId);
    // Both halves: the hand gained one AND the deck lost one, so this is a draw rather than a card
    // arriving from anywhere else.
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.deckCount).toBe(before.deckCount - 1);
  });

  test("nothing is drawn while Buggy merely survives a battle", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [{ card: op15Buggy012, rested: true }], deck: 10 },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const buggyId = engine.findCardInZone("south", "character", op15Buggy012);
    const deckBefore = engine.getView("south").players.south.deckCount;

    // Attack the Leader instead: Buggy is untouched, so its [On K.O.] must not fire.
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op15Buggy012)).toBe(buggyId);
    // The hand is NOT the assertion here: taking damage moves a Life card into it. The deck is --
    // a draw is the only thing in this scenario that would shorten it.
    expect(view.players.south.deckCount).toBe(deckBefore);
  });
});
