import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op06GeckoMoria080, op15Margarita091 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP15-091 Margarita", () => {
  function margaritaWithTrashes() {
    return OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        hand: [op15Margarita091],
        deck: 10,
        activeDon: 3,
        // A card in the effect controller's OWN trash. `player: "opponent"` is what keeps it out
        // of the candidate pool; scoped to "self" or "any" this would show up.
        trash: [op03Namule007],
      },
      { deck: 10, trash: [op02Atmos003] },
    );
  }

  test("only the opponent's trash is offered, and the card goes to the bottom of THEIR deck", () => {
    const engine = margaritaWithTrashes();
    const opponentTrashed = engine.findCardInZone("north", "trash", op02Atmos003);
    const ownTrashed = engine.findCardInZone("south", "trash", op03Namule007);
    const southDeckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Margarita091, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Margarita's trash target.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([opponentTrashed]);
    expect(candidateIds).not.toContain(ownTrashed);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [opponentTrashed] }, "south");

    const state = engine.getState();
    // "the OWNER's deck" -- north's, not the effect controller's.
    expect(state.cards[opponentTrashed]?.zone).toBe("deck");
    expect(state.players.north.trash).toHaveLength(0);
    expect(state.players.south.deck).toHaveLength(southDeckBefore);
    // `position: "bottom"`, so it is the LAST entry. Asserting mere membership would pass for
    // `position: "top"` too.
    const northDeck = state.players.north.deck;
    expect(northDeck[northDeck.length - 1]).toBe(opponentTrashed);
    expect(northDeck).toHaveLength(11);
  });

  test('"up to 1" -- the selection may be declined and nothing moves', () => {
    const engine = margaritaWithTrashes();
    const opponentTrashed = engine.findCardInZone("north", "trash", op02Atmos003);

    engine.playCard(op15Margarita091, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    const state = engine.getState();
    expect(state.cards[opponentTrashed]?.zone).toBe("trash");
    expect(state.players.north.deck).toHaveLength(10);
  });
});
