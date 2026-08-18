import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Doberman107,
  op02Komille097,
  op02Smoker093,
  op03Namule007,
  op16Koby064,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// There is no [Navy] Character named "Koby" in the pre-OP15 pool -- OP11-001 Koby is a Leader, and
// a Leader cannot sit in a deck -- so the one card that can exercise `excludeName` has to be
// synthetic. It is spread from a genuinely vanilla Navy body, and `i18n.en.name` is overridden as
// well as `name`, because the name filters read `card.i18n.en.name` via `cardName()`.
const kobyInDeck: CharacterCard = {
  ...op02Komille097,
  id: "TEST-OP16-064-KOBY",
  canonicalId: "TEST-OP16-064-KOBY",
  name: "Koby",
  i18n: { en: { ...op02Komille097.i18n.en, name: "Koby" } },
};

registerCards([kobyInDeck]);

describe("OP16-064 Koby", () => {
  test("looks at 5, may keep a [Navy] card that is not another Koby, and bottoms the rest", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op16Koby064],
        deck: [
          // Top 5.
          op02Komille097, // Navy, legal
          kobyInDeck, // Navy but named Koby -- only `excludeName` keeps it out
          op03Namule007, // not Navy
          op02Doberman107, // Navy, legal (two legal cards, so the illegal ones are visible)
          eb01Doma005, // not Navy
          // A 6th card the look must never reach.
          op02Doberman107,
        ],
        activeDon: op16Koby064.cost,
      },
      {},
    );
    const [komilleId, sameNameId, wrongTraitId, dobermanId, domaId, sixthId] = engine.getState()
      .players.south.deck as [string, string, string, string, string, string];

    engine.playCard(op16Koby064, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Koby's look-at-5.");
    expect(look).toMatchObject({ min: 0, max: 1 });
    // The search prompt lists every looked-at card with a per-candidate `legal` flag, so
    // exclusions must be asserted through `legal` -- `not.toContain` would pass vacuously.
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      komilleId,
      sameNameId,
      wrongTraitId,
      dobermanId,
      domaId,
    ]);
    // Exactly 5 looked at: the 6th card is what pins `lookCount: 5`.
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixthId);
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([komilleId, dobermanId]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [komilleId] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [sameNameId, wrongTraitId, dobermanId, domaId] },
      "south",
    );

    const view = engine.getView("south");
    // `revealDestination: "hand"` -- the kept card is in hand, not on the field or in the trash.
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([komilleId]);
    expect(view.players.south.trash).toHaveLength(0);
    // `remainderPosition: "bottom"` -- the 4 unkept cards go UNDER the untouched 6th card, so the
    // whole deck array has to be asserted rather than a slice off the end.
    expect(engine.getState().players.south.deck).toEqual([
      sixthId,
      sameNameId,
      wrongTraitId,
      dobermanId,
      domaId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test("may keep nothing, in which case all 5 go to the bottom", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op16Koby064],
        deck: [op02Komille097, op03Namule007, eb01Doma005, op02Doberman107, op03Namule007],
        activeDon: op16Koby064.cost,
      },
      {},
    );
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);

    engine.playCard(op16Koby064, "south");
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: lookedIds }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(0);
    expect(view.players.south.deckCount).toBe(5);
    expect(view.prompts).toHaveLength(0);
  });
});
