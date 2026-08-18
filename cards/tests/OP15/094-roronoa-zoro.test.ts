import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op01MonkeyDLuffy003,
  op02Atmos003,
  op02Thatch007,
  op02Usopp028,
  op15RoronoaZoro094,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// 因对方的效果 -- the opponent's EFFECT, so the removal source has to be one.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-094-RETURN",
  canonicalId: "TEST-OP15-094-RETURN",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: { player: "any", zones: ["character"], count: { amount: 1 } },
          },
        ],
      },
    ],
  },
};

registerCards([returnCharacter]);

function zoroProtecting(extra: PlayerFixture["character"], options = {}) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op01MonkeyDLuffy003,
      character: [op15RoronoaZoro094, ...(extra ?? [])],
      deck: 10,
    },
    { hand: [returnCharacter], activeDon: 3 },
    { firstPlayer: "north", activeSeat: "north", ...options },
  );
}

describe("OP15-094 Roronoa Zoro", () => {
  test("a [Straw Hat Crew] ally is saved by trashing this Character", () => {
    const engine = zoroProtecting([op02Usopp028]);
    const usoppId = engine.findCardInZone("south", "character", op02Usopp028);
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [usoppId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    const state = engine.getState();
    expect(state.cards[usoppId]?.zone).toBe("character");
    expect(state.cards[zoroId]?.zone).toBe("trash");
  });

  test("an ally without the type is not protected at all", () => {
    // op02Atmos003 is [Whitebeard Pirates] -- right about everything except the trait, so it is
    // what makes `delete filter:trait` killable.
    const engine = zoroProtecting([op02Atmos003]);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [atmosId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[atmosId]?.zone).toBe("hand");
  });

  test("此角色以外的: this Character cannot save ITSELF", () => {
    // Zoro is [Straw Hat Crew] himself, so `excludeSelf` is the only thing keeping him out of his
    // own target pool -- and the exact opposite of OP15-090 Perona, whose ruling #925 says she
    // CAN. Neither card's filter set may be copied onto the other.
    const engine = zoroProtecting([]);
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [zoroId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[zoroId]?.zone).toBe("hand");
  });

  test('declining lets the ally go -- it is a "may"', () => {
    const engine = zoroProtecting([op02Usopp028]);
    const usoppId = engine.findCardInZone("south", "character", op02Usopp028);
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.playCard(returnCharacter, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [usoppId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.cards[usoppId]?.zone).toBe("hand");
    expect(state.cards[zoroId]?.zone).toBe("character");
  });

  test("your OWN effect removing the ally is not replaced either", () => {
    // 因**对方**的效果. `source: "opponentEffect"` is the field carrying that half, and also the
    // one doing the cause gating -- `findRemovalReplacement` accepts it only when the removal is
    // an effect AND its controller is the other seat.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        character: [op15RoronoaZoro094, op02Usopp028],
        hand: [returnCharacter],
        deck: 10,
        activeDon: 3,
      },
      {},
    );
    const usoppId = engine.findCardInZone("south", "character", op02Usopp028);
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.playCard(returnCharacter, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [usoppId] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[usoppId]?.zone).toBe("hand");
    expect(engine.getState().cards[zoroId]?.zone).toBe("character");
  });

  test("a battle K.O. of an ally is NOT replaceable", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        character: [op15RoronoaZoro094, { card: op02Usopp028, rested: true }],
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const usoppId = engine.findCardInZone("south", "character", op02Usopp028);
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      usoppId,
      "north",
    );
    // Zoro's own printed [Blocker] opens a step before damage; decline it so the battle resolves.
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "south");

    expect(engine.getState().cards[usoppId]?.zone).toBe("trash");
    expect(engine.getState().cards[zoroId]?.zone).toBe("character");
  });

  test("[Blocker] is a printed keyword on this card", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op01MonkeyDLuffy003, character: [op15RoronoaZoro094], deck: 10 },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const zoroId = engine.findCardInZone("south", "character", op15RoronoaZoro094);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([zoroId]);
  });
});
