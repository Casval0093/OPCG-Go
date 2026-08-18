import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Komachiyo010,
  op01Sai012,
  op02Kingdew006,
  op09MarshallDTeach081,
  op16DocQ109,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// op09MarshallDTeach081 is the Blackbeard Pirates Leader. Its own printed effect only negates [On
// Play] effects, so it cannot interfere with an [On K.O.].
function southBoard() {
  return {
    character: [
      // cost 5, 7000 power -- the attacker, and outside "a cost of 1 or less".
      { card: op02Kingdew006, playedOnTurn: 0 },
      // Two cost-1 bodies: "up to 2" needs two legal targets to be worth anything.
      eb01Doma005,
      op01Komachiyo010,
      // cost 2 -- clear of the line, so `lte 1` and `gte 1` are distinguishable.
      op01Sai012,
    ],
  };
}

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-109 Doc Q", () => {
  test("[On K.O.] under a [Blackbeard Pirates] Leader draws 1 and K.O.s up to 2 cost-1-or-less Characters", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      {
        leaderCardId: op09MarshallDTeach081,
        character: [{ card: op16DocQ109, rested: true }],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const docQId = engine.findCardInZone("north", "character", op16DocQ109);
    const eligibleIds = [
      engine.findCardInZone("south", "character", eb01Doma005),
      engine.findCardInZone("south", "character", op01Komachiyo010),
    ];
    const clearOfLineId = engine.findCardInZone("south", "character", op01Sai012);

    engine.declareAttack(attackerId, docQId, "south");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);

    const ko = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected Doc Q's K.O. choice.");
    expect(ko.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...eligibleIds].sort(),
    );
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(clearOfLineId);
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(attackerId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: eligibleIds }, "north");

    const state = engine.getState();
    expect(state.cards[eligibleIds[0]!]?.zone).toBe("trash");
    expect(state.cards[eligibleIds[1]!]?.zone).toBe("trash");
    expect(state.cards[clearOfLineId]?.zone).toBe("character");
  });

  test("[On K.O.] does nothing at all without a [Blackbeard Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      { character: [{ card: op16DocQ109, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const docQId = engine.findCardInZone("north", "character", op16DocQ109);
    const wouldBeTargetId = engine.findCardInZone("south", "character", eb01Doma005);

    engine.declareAttack(attackerId, docQId, "south");

    expect(engine.getState().cards[docQId]?.zone).toBe("trash");
    // Neither half of the block runs: no draw, and no target prompt.
    expect(engine.getView("north").players.north.hand).toHaveLength(0);
    expect(pendingIntents(engine)).toEqual([]);
    expect(engine.getState().cards[wouldBeTargetId]?.zone).toBe("character");
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      southBoard(),
      {
        leaderCardId: op09MarshallDTeach081,
        life: [op16DocQ109, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const docQId = engine.findCardInZone("north", "life", op16DocQ109);
    const targetId = engine.findCardInZone("south", "character", eb01Doma005);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "north");

    expect(engine.getState().cards[targetId]?.zone).toBe("trash");
    expect(engine.getState().cards[docQId]?.zone).toBe("trash");
  });
});
