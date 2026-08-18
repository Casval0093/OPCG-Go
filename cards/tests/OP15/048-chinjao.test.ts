import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op01Bellamy076,
  op01Sai012,
  op02Smoker093,
  op02Thatch007,
  op04TruenoBastardo094,
  op10BlueGilly054,
  op10GumGumRhinoSchneider097,
  op15Chinjao048,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A south-controlled way to K.O. Chinjao during SOUTH's own turn. A battle cannot do this: an
// attacker is never K.O.'d by attacking, so the only route to "my Character died on my turn" is
// an effect.
const koOwnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-048-KO",
  canonicalId: "TEST-OP15-048-KO",
  name: "Test Chinjao KOer",
  i18n: { en: { ...eb01Doma005.i18n.en, name: "Test Chinjao KOer" } },
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "ko",
            target: { player: "self", zones: ["character"], count: { amount: 1 } },
          },
        ],
      },
    ],
  },
};

registerCards([koOwnCharacter]);

describe("OP15-048 Chinjao", () => {
  test("[On Play] trashes 1 Event -- and only an Event -- to draw 2", () => {
    // Its own fixtures rather than OP15-045 Sai's: the two cards print the same clause but are two
    // independent objects with two independent copies of the filter.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [
          op15Chinjao048,
          op04TruenoBastardo094,
          op10GumGumRhinoSchneider097,
          op10BlueGilly054,
        ],
        activeDon: 4,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const truenoId = engine.findCardInZone("south", "hand", op04TruenoBastardo094);
    const rhinoId = engine.findCardInZone("south", "hand", op10GumGumRhinoSchneider097);
    const characterId = engine.findCardInZone("south", "hand", op10BlueGilly054);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Chinjao048, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Chinjao's Event-trash cost.");
    expect(cost.candidates.map((candidate) => candidate.ref.id)).toEqual([truenoId, rhinoId]);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(characterId);

    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [truenoId] }, "south");

    const state = engine.getState();
    expect(state.players.south.deck).toHaveLength(deckBefore - 2);
    expect(state.players.south.trash).toContain(truenoId);
    expect(state.players.south.hand).toHaveLength(4);
  });

  test("with no Event in hand the [On Play] publishes no prompt at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Chinjao048, op10BlueGilly054, op01Bellamy076],
        activeDon: 4,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Chinjao048, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.deck).toHaveLength(deckBefore);
  });

  test("[Opponent's Turn] [On K.O.]: the OPPONENT picks a card from their own hand to bottom", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [{ card: op15Chinjao048, rested: true }] },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Thatch007, playedOnTurn: 0 }],
        // Two cards, or the single candidate auto-resolves with no prompt to inspect.
        hand: [op01Bellamy076, op01Sai012],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const chinjaoId = engine.findCardInZone("south", "character", op15Chinjao048);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const chosenId = engine.findCardInZone("north", "hand", op01Sai012);
    const northDeckBefore = engine.getState().players.north.deck.length;

    engine.declareAttack(thatchId, chinjaoId, "north");
    expect(engine.getState().cards[chinjaoId]?.zone).toBe("trash");

    // `chosenBy: "opponent"` -- the prompt belongs to NORTH, not to Chinjao's controller.
    const choice = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected the opponent's hand choice.");
    expect(choice.candidates).toHaveLength(2);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [chosenId] }, "north");

    const state = engine.getState();
    // Bottom of THEIR deck, out of THEIR hand -- and nothing of south's moved.
    expect(state.players.north.deck).toHaveLength(northDeckBefore + 1);
    expect(state.players.north.deck.at(-1)).toBe(chosenId);
    expect(state.players.north.hand).not.toContain(chosenId);
    expect(state.players.south.hand).toHaveLength(0);
  });

  test("K.O.'d on YOUR OWN turn, the [On K.O.] does nothing", () => {
    // The [Opponent's Turn] gate. Drop the `turn` condition and north loses a card here.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [op15Chinjao048],
        hand: [koOwnCharacter],
        activeDon: 1,
      },
      { leaderCardId: op02Smoker093, hand: [op01Bellamy076, op01Sai012] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const chinjaoId = engine.findCardInZone("south", "character", op15Chinjao048);
    const northDeckBefore = engine.getState().players.north.deck.length;

    engine.playCard(koOwnCharacter, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [chinjaoId] }, "south");

    const state = engine.getState();
    expect(state.cards[chinjaoId]?.zone).toBe("trash");
    expect(state.players.north.hand).toHaveLength(2);
    expect(state.players.north.deck).toHaveLength(northDeckBefore);
    expect(
      state.promptQueue
        .filter((prompt) => prompt.status === "pending")
        .map((prompt) => prompt.resolutionContext?.intent),
    ).not.toContain("effectTargetSelection");
  });
});
