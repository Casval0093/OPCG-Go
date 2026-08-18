import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Atmos003,
  op02Smoker093,
  op02Thatch007,
  op04TruenoBastardo094,
  op10BlueGilly054,
  op15Rebecca053,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Its own fixtures, not OP15-040 Viola's: a duplicated printed clause is two independent objects
// with two independent copies of every filter, so sharing a fixture would leave one of them
// unprobed.
//   op10BlueGilly054        Character, [Dressrosa]         -- legal
//   op02Atmos003            Character, Whitebeard Pirates  -- illegal (trait filter alone)
//   op04TruenoBastardo094   EVENT,     [Dressrosa]         -- legal: "type CARD", no cardCategory
//   op01Sai012              never looked at
function rebeccaOnPlay() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      hand: [op15Rebecca053],
      deck: [op10BlueGilly054, op02Atmos003, op04TruenoBastardo094, op01Sai012],
      activeDon: 1,
    },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-053 Rebecca", () => {
  test("[On Play] looks at 3; only [Dressrosa] cards are revealable, Events included", () => {
    const engine = rebeccaOnPlay();
    const dressrosaCharacterId = engine.findCardInZone("south", "deck", op10BlueGilly054);
    const wrongTraitId = engine.findCardInZone("south", "deck", op02Atmos003);
    const dressrosaEventId = engine.findCardInZone("south", "deck", op04TruenoBastardo094);
    const untouchedId = engine.findCardInZone("south", "deck", op01Sai012);

    engine.playCard(op15Rebecca053, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Rebecca's reveal choice.");
    expect(
      search.candidates.map((candidate) => ({ id: candidate.ref.id, legal: candidate.legal })),
    ).toEqual([
      { id: dressrosaCharacterId, legal: true },
      { id: wrongTraitId, legal: false },
      { id: dressrosaEventId, legal: true },
    ]);
    expect(search.candidates.map((candidate) => candidate.ref.id)).not.toContain(untouchedId);

    engine.resolveDecision(
      "effectSearchSelection",
      { selectedIds: [dressrosaCharacterId] },
      "south",
    );

    const order = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [dressrosaEventId, wrongTraitId] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(dressrosaCharacterId);
    expect(engine.getState().players.south.deck).toEqual([
      untouchedId,
      dressrosaEventId,
      wrongTraitId,
    ]);
  });

  test("[DON!! x1] grants [Blocker] -- with a DON!! attached she can block", () => {
    // Attached DON!! survives the opponent's whole turn (`resetStartOfTurnState` returns it at the
    // start of its OWN controller's turn), so the sequence is: attach on your turn, end it, then
    // let the opponent attack.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Rebecca053], activeDon: 1 },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );
    const rebeccaId = engine.findCardInZone("south", "character", op15Rebecca053);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.attachDon(rebeccaId, 1, "south");
    engine.endTurn("south");
    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    // The candidate list carries a synthetic "skip" entry, so filter before comparing.
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([rebeccaId]);
  });

  test("with no DON!! attached she is not a [Blocker] at all", () => {
    // The control that makes the previous test mean something: identical board, no attachDon, and
    // the blocker step never opens. Drop the `donAttached` condition and this goes red.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op15Rebecca053], activeDon: 1 },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.endTurn("south");
    engine.declareAttack(thatchId, engine.leader("south"), "north");

    expect(
      engine
        .getState()
        .promptQueue.filter((prompt) => prompt.status === "pending")
        .map((prompt) => prompt.resolutionContext?.intent),
    ).not.toContain("battleBlocker");
  });
});
