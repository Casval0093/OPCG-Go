import { describe, expect, test } from "vite-plus/test";
import {
  op01MonkeyDLuffy003,
  op02Atmos003,
  op06GeckoMoria080,
  op15DrHogback084,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op06GeckoMoria080's traits are the concatenated string
// "The Seven Warlords of the Sea Thriller Bark Pirates", so it is what makes `match: "includes"`
// load-bearing here. Its only ability is a [When Attacking], which never fires on an [On Play].
const NORTH_ACTS = { firstPlayer: "south", activeSeat: "north" } as const;

function koHogbackWithHandOf(handSize: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op06GeckoMoria080,
      character: [{ card: op15DrHogback084, rested: true }],
      hand: handSize,
      deck: 20,
    },
    { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
    NORTH_ACTS,
  );
  const attackerId = engine.findCardInZone("north", "character", op02Atmos003);
  const hogbackId = engine.findCardInZone("south", "character", op15DrHogback084);

  engine.declareAttack(attackerId, hogbackId, "north");
  // A defender holding cards gets a battleCounter step before damage resolves; decline it so the
  // K.O. -- and only then the [On K.O.] -- actually happens.
  engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
  return engine;
}

describe("OP15-084 Dr. Hogback", () => {
  test("under a [Thriller Bark Pirates] Leader the [On Play] mills exactly 5", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op06GeckoMoria080, hand: [op15DrHogback084], deck: 20, activeDon: 3 },
      {},
    );
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15DrHogback084, "south");

    expect(engine.getState().players.south.deck).toHaveLength(deckBefore - 5);
    expect(engine.getState().players.south.trash).toHaveLength(5);
  });

  test("under a Leader without the type the [On Play] does nothing", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op01MonkeyDLuffy003, hand: [op15DrHogback084], deck: 20, activeDon: 3 },
      {},
    );
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15DrHogback084, "south");

    expect(engine.getState().players.south.deck).toHaveLength(deckBefore);
    expect(engine.getState().players.south.trash).toHaveLength(0);
  });

  test("[On K.O.] at exactly 6 cards in hand draws -- the printed boundary", () => {
    // 6 is ON the line. `value: 6` is a single digit, so mutation_check.py never perturbs it;
    // this pair of tests is the only thing pinning the threshold, and it has to be 6-vs-7 rather
    // than (say) 3-vs-9 for that reason.
    const state = koHogbackWithHandOf(6).getState();

    // The fixture deck is 20 and nothing else touches it, so 19 IS the draw.
    expect(state.players.south.deck).toHaveLength(19);
    expect(state.players.south.hand).toHaveLength(7);
  });

  test("[On K.O.] at 7 cards in hand draws nothing", () => {
    const state = koHogbackWithHandOf(7).getState();

    // Counted on the deck, not the hand: this is the negative control, and a hand that stays at
    // 7 would look the same whether the draw happened and something else trimmed it or not.
    expect(state.players.south.deck).toHaveLength(20);
    expect(state.players.south.hand).toHaveLength(7);
  });
});
