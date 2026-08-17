import { describe, expect, test } from "vite-plus/test";
import {
  op02Blugori084,
  op02Sphinx088,
  op03Namule007,
  op05Bellamy035,
  op16MonkeyDLuffy034,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The card's other printed clause -- the DON!! x1 power scaling -- is parked, see the PARKED
// note on cards/OP16/characters/034-monkey-d-luffy.ts and data/parked-clauses.json.

describe("OP16-034 Monkey.D.Luffy", () => {
  test("[On Play] looks at 3 and only an [Impel Down] card may be taken; the rest go to the deck bottom in the chosen order", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16MonkeyDLuffy034],
        deck: [op02Sphinx088, op03Namule007, op02Blugori084, op05Bellamy035],
        activeDon: 1,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const impelDownId = engine.findCardInZone("south", "deck", op02Sphinx088);
    const notImpelDownId = engine.findCardInZone("south", "deck", op03Namule007);
    const otherImpelDownId = engine.findCardInZone("south", "deck", op02Blugori084);
    const untouchedBottomId = engine.findCardInZone("south", "deck", op05Bellamy035);

    engine.playCard(op16MonkeyDLuffy034, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Luffy's reveal choice.");
    expect(
      search.candidates.map((candidate) => ({ id: candidate.ref.id, legal: candidate.legal })),
    ).toEqual([
      { id: impelDownId, legal: true },
      { id: notImpelDownId, legal: false },
      { id: otherImpelDownId, legal: true },
    ]);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [impelDownId] }, "south");

    const order = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
    expect(order.candidates.map((candidate) => candidate.ref.id)).toEqual([
      notImpelDownId,
      otherImpelDownId,
    ]);
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [otherImpelDownId, notImpelDownId] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([impelDownId]);
    // The remainder lands BEHIND the card the search never looked at, so assert the whole deck.
    expect(engine.getState().players.south.deck).toEqual([
      untouchedBottomId,
      otherImpelDownId,
      notImpelDownId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test("taking nothing is allowed, and all 3 then go to the bottom", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16MonkeyDLuffy034],
        deck: [op03Namule007, op05Bellamy035, op03Namule007, op05Bellamy035],
        activeDon: 1,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op16MonkeyDLuffy034, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected Luffy's reveal choice.");
    expect(search.candidates.every((candidate) => candidate.legal === false)).toBe(true);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");

    const order = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
    if (order?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
    const remainderIds = order.candidates.map((candidate) => candidate.ref.id);
    expect(remainderIds).toHaveLength(3);
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: remainderIds }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(0);
    expect(engine.getState().players.south.deck).toHaveLength(4);
    expect(view.prompts).toHaveLength(0);
  });
});
