import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb02DonAccino004,
  op02Atmos003,
  op03Namule007,
  op05BartholomewKuma011,
  st01GuardPoint014,
  st12EmporioIvankov010,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A second attack in the same turn is otherwise unreachable: attacking rests Ivankov and
// nothing on the card setActives it. This helper exists only to pin `oncePerTurn`.
const setActiveHelper: CharacterCard = {
  ...op03Namule007,
  id: "TEST-ST12-010-SET-ACTIVE",
  canonicalId: "TEST-ST12-010-SET-ACTIVE",
  name: "Set Active Helper",
  i18n: { en: { ...op03Namule007.i18n.en, name: "Set Active Helper" } },
  effects: {
    effects: [
      {
        trigger: "activateMain",
        actions: [
          {
            action: "setActive",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
            },
          },
        ],
      },
    ],
  },
};

registerCards([setActiveHelper]);

const FILLER = [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003];

function playIvankov(deck: Array<(typeof op05BartholomewKuma011) | (typeof op03Namule007) | (typeof st01GuardPoint014) | (typeof op02Atmos003)>, handExtra: Array<typeof op05BartholomewKuma011> = []) {
  return OnePieceTestEngine.create({
    hand: [st12EmporioIvankov010, ...handExtra],
    deck,
    activeDon: 3,
  });
}

function attackWithIvankov(handSize: number, extraCharacters: Array<{ card: CharacterCard; playedOnTurn?: number }> = []) {
  const engine = OnePieceTestEngine.create(
    {
      character: [{ card: st12EmporioIvankov010, playedOnTurn: 0 }, ...extraCharacters],
      hand: [...FILLER, ...FILLER].slice(0, handSize),
      deck: [...FILLER, ...FILLER],
    },
    {
      // eb02DonAccino004 is a vanilla 10000-power body, rested so it is a legal attack target.
      // Ivankov at 4000 loses the exchange: nothing is K.O.'d, no Life moves, and no
      // battleCounter opens (north's hand is empty), so the only observable is the draw.
      character: [{ card: eb02DonAccino004, playedOnTurn: 0, rested: true }],
      hand: [],
    },
    { firstPlayer: "north", activeSeat: "south" },
  );
  const ivankovId = engine.findCardInZone("south", "character", st12EmporioIvankov010);
  const defenderId = engine.findCardInZone("north", "character", eb02DonAccino004);
  engine.declareAttack(ivankovId, defenderId, "south");
  return { engine, ivankovId, defenderId };
}

describe("ST12-010 Emporio.Ivankov", () => {
  test("[On Play] plays the revealed cost-2 Character and skips the remainder prompt", () => {
    const engine = playIvankov([op05BartholomewKuma011, op02Atmos003]);
    const playId = engine.findCardInZone("south", "deck", op05BartholomewKuma011);

    engine.playCard(st12EmporioIvankov010, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [playId] }, "south");

    expect(
      engine.getView("south").players.south.characters.some((card) => card?.instanceId === playId),
    ).toBe(true);
    expect(engine.getState().players.south.deck.at(-1)).not.toBe(playId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("declining the revealed play lets you put that leftover card on deck bottom", () => {
    // Ruling #164: "the rest" is the leftover revealed card, not a card from hand.
    const engine = playIvankov([op05BartholomewKuma011, op02Atmos003]);
    const revealedId = engine.findCardInZone("south", "deck", op05BartholomewKuma011);

    engine.playCard(st12EmporioIvankov010, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectRevealedDeckPosition", { optionId: "bottom" }, "south");

    expect(engine.getState().players.south.deck.at(-1)).toBe(revealedId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("ruling #163: a cost-2 Character in hand is not a play candidate", () => {
    const engine = playIvankov([op05BartholomewKuma011, op02Atmos003], [op05BartholomewKuma011]);
    const revealedId = engine.getState().players.south.deck[0];
    const handKumaId = engine.findCardInZone("south", "hand", op05BartholomewKuma011);

    engine.playCard(st12EmporioIvankov010, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Ivankov's play choice.");
    const candidateIds = play.candidates
      .map((candidate) => candidate.ref.id)
      .filter((id) => id !== "skip");
    expect(candidateIds).toEqual([revealedId]);
    expect(candidateIds).not.toContain(handKumaId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectRevealedDeckPosition", { optionId: "top" }, "south");
  });

  test("a second cost-2 Character below the top of the deck is not a play candidate", () => {
    // `topOnly: true` -- without it the play action would offer every matching deck card.
    const engine = playIvankov([op05BartholomewKuma011, op05BartholomewKuma011]);
    const [topId, belowId] = engine.getState().players.south.deck;

    engine.playCard(st12EmporioIvankov010, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Ivankov's play choice.");
    const candidateIds = play.candidates
      .map((candidate) => candidate.ref.id)
      .filter((id) => id !== "skip");
    expect(candidateIds).toEqual([topId]);
    expect(candidateIds).not.toContain(belowId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectRevealedDeckPosition", { optionId: "top" }, "south");
  });

  test("a cost-3 Character on top offers no play, only the remainder choice", () => {
    // Pins `cost eq 2`. op03Namule007 is cost 3; `eq` -> `gte`/`lte` or deleting the filter
    // would open a play prompt here. `value: 2` is a single digit, so this boundary is ours.
    const engine = playIvankov([op03Namule007, op02Atmos003]);
    const revealedId = engine.findCardInZone("south", "deck", op03Namule007);

    engine.playCard(st12EmporioIvankov010, "south");

    // A matching reveal would open effectPlaySelection first; resolving the remainder
    // would then either throw or leave that play prompt behind.
    engine.resolveDecision("effectRevealedDeckPosition", { optionId: "bottom" }, "south");
    expect(engine.getState().players.south.deck.at(-1)).toBe(revealedId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("an Event on top offers no play, only the remainder choice", () => {
    // Pins `cardCategory: "character"`. Delete that filter and Guard Point becomes playable.
    const engine = playIvankov([st01GuardPoint014, op02Atmos003]);
    const revealedId = engine.findCardInZone("south", "deck", st01GuardPoint014);

    engine.playCard(st12EmporioIvankov010, "south");

    engine.resolveDecision("effectRevealedDeckPosition", { optionId: "bottom" }, "south");
    expect(engine.getState().players.south.deck.at(-1)).toBe(revealedId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("at exactly 6 cards in hand, attacking draws 1", () => {
    const { engine } = attackWithIvankov(6);

    expect(engine.getView("south").players.south.hand).toHaveLength(7);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("at 7 cards in hand, attacking draws nothing", () => {
    // Also kills the lte->gte mutant: "6 or more" would draw here.
    const { engine } = attackWithIvankov(7);

    expect(engine.getView("south").players.south.hand).toHaveLength(7);
  });

  test("[Once Per Turn]: a second attack the same turn does not draw", () => {
    const { engine, ivankovId, defenderId } = attackWithIvankov(6, [
      { card: setActiveHelper, playedOnTurn: 0 },
    ]);
    expect(engine.getView("south").players.south.hand).toHaveLength(7);

    const helperId = engine.findCardInZone("south", "character", setActiveHelper);
    engine.activateEffect(helperId, "activateMain", "south");
    const setActive = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(setActive?.kind).toBe("selectEntity");
    if (setActive?.kind !== "selectEntity") throw new Error("Expected the setActive choice.");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [ivankovId] }, "south");
    expect(engine.getState().cards[ivankovId]?.rested).toBe(false);

    engine.declareAttack(ivankovId, defenderId, "south");
    // Drop `oncePerTurn` and this second attack draws to 8.
    expect(engine.getView("south").players.south.hand).toHaveLength(7);
  });
});
