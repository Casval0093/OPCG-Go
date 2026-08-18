import { describe, expect, test } from "vite-plus/test";
import {
  op01Bellamy076,
  op02Seaquake021,
  op02Smoker093,
  op02Thatch007,
  op04GumGumKingKongGun093,
  op04TruenoBastardo094,
  op15Bartolomeo014,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Hand fixtures for the [On Play], each isolating one filter:
//   op04GumGumKingKongGun093  Event, cost 3, "Straw Hat Crew Dressrosa" -- EXACTLY on the base-cost
//                                                                         line, and its [Main] is
//                                                                         observable (+6000 to a
//                                                                         [Dressrosa] Character,
//                                                                         which Bartolomeo is)
//   op04TruenoBastardo094     Event, cost 4, "Dressrosa"               -- one over the line
//   op02Seaquake021           Event, cost 1, Whitebeard Pirates        -- inside the line, wrong trait
//   op01Bellamy076            CHARACTER, cost 2, "Dressrosa"           -- inside the line and with the
//                                                                         RIGHT trait, so `cardCategory`
//                                                                         is the only thing excluding
//                                                                         it. It has to be a Dressrosa
//                                                                         body: a Character that also
//                                                                         fails the trait check leaves
//                                                                         `delete filter:cardCategory`
//                                                                         unkillable, which is exactly
//                                                                         what mutation_check.py caught
//                                                                         here. Unlike a `play` action,
//                                                                         `activateEvent`'s candidate
//                                                                         pool is NOT pre-narrowed by
//                                                                         card type, so a Character is
//                                                                         a genuine false positive.

describe("OP15-014 Bartolomeo", () => {
  test("[On Play] offers only [Dressrosa] Events with a base cost of 3 or less, and really activates one", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [
          op15Bartolomeo014,
          op04GumGumKingKongGun093,
          op04TruenoBastardo094,
          op02Seaquake021,
          op01Bellamy076,
        ],
        activeDon: 4,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const gumGumId = engine.findCardInZone("south", "hand", op04GumGumKingKongGun093);

    engine.playCard(op15Bartolomeo014, "south");
    const bartolomeoId = engine.findCardInZone("south", "character", op15Bartolomeo014);

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Bartolomeo's Event choice.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([gumGumId]);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [gumGumId] }, "south");

    // The chosen Event's own [Main] now resolves: +6000 to up to 1 [Dressrosa] Character.
    // Bartolomeo has the type, so pointing it at himself proves the activation actually happened
    // rather than the card merely being discarded.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [bartolomeoId] }, "south");

    const view = engine.getView("south");
    expect(
      view.players.south.characters.find((card) => card?.instanceId === bartolomeoId)?.power,
    ).toBe(12000);
    expect(view.players.south.hand.map((card) => card.instanceId)).not.toContain(gumGumId);
  });

  test('"up to 1" may be declined', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Bartolomeo014, op04GumGumKingKongGun093],
        activeDon: 4,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const gumGumId = engine.findCardInZone("south", "hand", op04GumGumKingKongGun093);

    engine.playCard(op15Bartolomeo014, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(gumGumId);
  });

  test("with nothing eligible in hand the [On Play] publishes no prompt", () => {
    // An `upTo` target with ZERO legal candidates publishes no prompt at all, so this covers every
    // filter a second time: relax any one of them and Trueno/Seaquake/Bellamy becomes eligible.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Bartolomeo014, op04TruenoBastardo094, op02Seaquake021, op01Bellamy076],
        activeDon: 4,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15Bartolomeo014, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("a battle K.O. can be replaced by trashing an Event -- and only an Event", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op15Bartolomeo014, rested: true }],
        hand: [op02Seaquake021, op01Bellamy076],
      },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const bartolomeoId = engine.findCardInZone("south", "character", op15Bartolomeo014);
    const seaquakeId = engine.findCardInZone("south", "hand", op02Seaquake021);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, bartolomeoId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    // A `trashFromHand` battle-K.O. replacement is a single `selectCards` prompt whose options are
    // the filter-matched hand -- Bellamy is a Character and must not be there.
    const replacement = engine.pendingDecision("battleKoReplacement", "south").steps[0];
    if (replacement?.kind !== "selectEntity")
      throw new Error("Expected Bartolomeo's hand-trash choice.");
    expect(replacement.candidates.map((candidate) => candidate.ref.id)).toEqual([seaquakeId]);

    engine.resolveDecision("battleKoReplacement", { selectedIds: [seaquakeId] }, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op15Bartolomeo014)).toBe(bartolomeoId);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(seaquakeId);
  });

  test("with no Event in hand the replacement is never offered", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op15Bartolomeo014, rested: true }],
        hand: [op01Bellamy076],
      },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const bartolomeoId = engine.findCardInZone("south", "character", op15Bartolomeo014);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, bartolomeoId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(
      engine
        .getState()
        .promptQueue.filter((prompt) => prompt.status === "pending")
        .map((prompt) => prompt.resolutionContext?.intent),
    ).not.toContain("battleKoReplacement");
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      bartolomeoId,
    );
  });
});
