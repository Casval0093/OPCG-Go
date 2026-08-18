import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Seaquake021,
  op02Smoker093,
  op02Thatch007,
  op04Barrier095,
  op10BlueGilly054,
  op15Koala044,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Deck fixture, top-first. Unlike Viola/Rebecca this card prints "[Dressrosa] type EVENT", so both
// filters have to be killable independently:
//   op04Barrier095    EVENT,     [Dressrosa]        -- legal
//   op10BlueGilly054  CHARACTER, [Dressrosa]        -- illegal on `cardCategory` ALONE; it has the
//                                                     right trait on purpose, or deleting
//                                                     `cardCategory` would change nothing
//   op02Seaquake021   EVENT,     Whitebeard Pirates -- illegal on `trait` alone
//   op02Atmos003      never looked at
function koalaOnField(rested: boolean) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op15Koala044, rested }],
      deck: [op04Barrier095, op10BlueGilly054, op02Seaquake021, op02Atmos003],
    },
    { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

describe("OP15-044 Koala", () => {
  test("the printed [Blocker] works", () => {
    const engine = koalaOnField(false);
    const koalaId = engine.findCardInZone("south", "character", op15Koala044);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([koalaId]);
  });

  test("[On K.O.] looks at 3; only a [Dressrosa] EVENT is revealable", () => {
    const engine = koalaOnField(true);
    const koalaId = engine.findCardInZone("south", "character", op15Koala044);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const dressrosaEventId = engine.findCardInZone("south", "deck", op04Barrier095);
    const dressrosaCharacterId = engine.findCardInZone("south", "deck", op10BlueGilly054);
    const wrongTraitEventId = engine.findCardInZone("south", "deck", op02Seaquake021);
    const untouchedId = engine.findCardInZone("south", "deck", op02Atmos003);

    // 8000 into a rested 2000 body. South's hand is empty, so no battleCounter step intervenes.
    engine.declareAttack(thatchId, koalaId, "north");
    expect(engine.getState().cards[koalaId]?.zone).toBe("trash");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected Koala's reveal choice.");
    expect(
      search.candidates.map((candidate) => ({ id: candidate.ref.id, legal: candidate.legal })),
    ).toEqual([
      { id: dressrosaEventId, legal: true },
      { id: dressrosaCharacterId, legal: false },
      { id: wrongTraitEventId, legal: false },
    ]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [dressrosaEventId] }, "south");

    const order = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [wrongTraitEventId, dressrosaCharacterId] },
      "south",
    );

    expect(engine.getView("south").players.south.hand.map((card) => card.instanceId)).toContain(
      dressrosaEventId,
    );
    expect(engine.getState().players.south.deck).toEqual([
      untouchedId,
      wrongTraitEventId,
      dressrosaCharacterId,
    ]);
  });
});
