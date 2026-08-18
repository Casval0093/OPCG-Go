import { describe, expect, test } from "vite-plus/test";
import {
  op01Bellamy076,
  op02Atmos003,
  op02Smoker093,
  op03Namule007,
  op04Barrier095,
  op15Viola040,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Deck fixture, top-first. The three looked-at cards each isolate one thing:
//   op01Bellamy076   CHARACTER, [Dressrosa]        -- legal
//   op03Namule007    Character, Whitebeard Pirates -- illegal; the only thing excluding it is the
//                                                     trait filter
//   op04Barrier095   EVENT,     [Dressrosa]        -- legal, and that is the point: the card
//                                                     prints "[Dressrosa] type CARD", so unlike
//                                                     OP15-044 Koala there is deliberately no
//                                                     `cardCategory` filter. Add one and this
//                                                     candidate flips to illegal.
//   op02Atmos003     never looked at               -- proves the remainder lands BEHIND it
function violaOnPlay() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      hand: [op15Viola040],
      deck: [op01Bellamy076, op03Namule007, op04Barrier095, op02Atmos003],
      activeDon: 1,
    },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-040 Viola", () => {
  test("[On Play] looks at 3; only [Dressrosa] cards are revealable, Events included", () => {
    const engine = violaOnPlay();
    const dressrosaCharacterId = engine.findCardInZone("south", "deck", op01Bellamy076);
    const wrongTraitId = engine.findCardInZone("south", "deck", op03Namule007);
    const dressrosaEventId = engine.findCardInZone("south", "deck", op04Barrier095);
    const untouchedId = engine.findCardInZone("south", "deck", op02Atmos003);

    engine.playCard(op15Viola040, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Viola's reveal choice.");
    // A `search` prompt lists every looked-at card with a per-candidate `legal` flag, so the
    // filter is asserted directly rather than by absence.
    expect(
      search.candidates.map((candidate) => ({ id: candidate.ref.id, legal: candidate.legal })),
    ).toEqual([
      { id: dressrosaCharacterId, legal: true },
      { id: wrongTraitId, legal: false },
      { id: dressrosaEventId, legal: true },
    ]);
    // lookCount is 3, not 4: the fourth card is not in the prompt at all.
    expect(search.candidates.map((candidate) => candidate.ref.id)).not.toContain(untouchedId);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [dressrosaEventId] }, "south");

    const order = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
    expect(order.candidates.map((candidate) => candidate.ref.id)).toEqual([
      dressrosaCharacterId,
      wrongTraitId,
    ]);
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [wrongTraitId, dressrosaCharacterId] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(dressrosaEventId);
    // Bottom, in the chosen order, behind the card the search never looked at.
    expect(engine.getState().players.south.deck).toEqual([
      untouchedId,
      wrongTraitId,
      dressrosaCharacterId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test('"up to 1" may be declined, and the whole look still goes to the bottom', () => {
    const engine = violaOnPlay();
    const dressrosaCharacterId = engine.findCardInZone("south", "deck", op01Bellamy076);
    const wrongTraitId = engine.findCardInZone("south", "deck", op03Namule007);
    const dressrosaEventId = engine.findCardInZone("south", "deck", op04Barrier095);
    const untouchedId = engine.findCardInZone("south", "deck", op02Atmos003);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15Viola040, "south");
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [dressrosaCharacterId, wrongTraitId, dressrosaEventId] },
      "south",
    );

    // Viola left the hand to be played, and nothing was added back.
    expect(engine.getState().players.south.hand).toHaveLength(handBefore - 1);
    expect(engine.getState().players.south.deck).toEqual([
      untouchedId,
      dressrosaCharacterId,
      wrongTraitId,
      dressrosaEventId,
    ]);
  });
});
