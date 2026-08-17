import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op02Doberman107,
  op02Komille097,
  op03Namule007,
  op16BuddhaSengoku077,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op02Komille097 and op02Doberman107 carry the "Navy" trait; op03Namule007, op02Atmos003 and
// eb01Doma005 do not. All are genuinely vanilla, and the Leader (op16PortgasDAce001,
// [Activate: Main] only) is irrelevant to this card.

function sengokuWith(deck: PlayerFixture["deck"], hand: PlayerFixture["hand"]) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: op16PortgasDAce001, hand, deck, activeDon: 1 },
    {},
  );
  engine.playCard(op16BuddhaSengoku077, "south");
  return engine;
}

describe('OP16-077 "Buddha" Sengoku', () => {
  test("[Main] looks at 5, takes up to 2 [Navy] type cards, then trashes 1 from hand", () => {
    const engine = sengokuWith(
      [
        op02Komille097,
        op03Namule007,
        op02Doberman107,
        op02Atmos003,
        eb01Doma005,
        // A 6th card the search must not reach.
        op02Komille097,
      ],
      [op16BuddhaSengoku077, op03Namule007],
    );
    const [komilleId, namuleId, dobermanId, atmosId, domaId, sixthId] = engine.getState().players
      .south.deck as [string, string, string, string, string, string];
    const handId = engine.findCardInZone("south", "hand", op03Namule007);

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected the look-at-5.");
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([komilleId, dobermanId]);
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixthId);
    engine.resolveDecision(
      "effectSearchSelection",
      { selectedIds: [komilleId, dobermanId] },
      "south",
    );

    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [namuleId, atmosId, domaId] },
      "south",
    );

    // Both revealed cards are in hand, and the mandatory trash then takes one card back out.
    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected the mandatory trash.");
    expect(trash.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [handId, komilleId, dobermanId].sort(),
    );
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [komilleId] }, "south");

    const state = engine.getState();
    // `state` arrays are frozen, so copy before sorting.
    expect([...state.players.south.hand].sort()).toEqual([handId, dobermanId].sort());
    expect(state.players.south.deck).toEqual([sixthId, namuleId, atmosId, domaId]);
  });

  test("ruling #1000: with NO [Navy] card among the five, the trash still happens", () => {
    // The reason the trash is a sibling action rather than a `thenActions` on the search. English
    // reads the sequence as consequential ("reveal ..., add them ... Then, trash 1"); #1000 says
    // the trash is unconditional (是的, 丢弃) whether 1 card or none was revealed.
    const engine = sengokuWith(
      [op03Namule007, op02Atmos003, eb01Doma005, op03Namule007, op02Atmos003, eb01Doma005],
      [op16BuddhaSengoku077, op03Namule007],
    );
    const handId = engine.findCardInZone("south", "hand", op03Namule007);
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected the look-at-5.");
    expect(look.candidates.filter((candidate) => candidate.legal)).toHaveLength(0);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: lookedIds }, "south");

    // Nothing was added to hand, so the only discardable card is the one that was already there --
    // a single candidate, which the engine resolves without a prompt.
    expect(engine.getState().players.south.hand).toHaveLength(0);
    expect(engine.getState().players.south.trash).toContain(handId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("ruling #1000: with exactly 1 [Navy] card revealed, the trash still happens", () => {
    const engine = sengokuWith(
      [op02Komille097, op03Namule007, op02Atmos003, eb01Doma005, op03Namule007, op02Atmos003],
      [op16BuddhaSengoku077],
    );
    const [komilleId, ...restIds] = engine.getState().players.south.deck.slice(0, 5) as [
      string,
      ...string[],
    ];

    engine.resolveDecision("effectSearchSelection", { selectedIds: [komilleId] }, "south");
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: restIds }, "south");

    // The single revealed card arrives in hand and is then the only thing available to trash, so
    // it goes straight back out again.
    expect(engine.getState().players.south.hand).toHaveLength(0);
    expect(engine.getState().players.south.trash).toContain(komilleId);
  });
});
