import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Blugori084,
  op02Sphinx088,
  op03Namule007,
  op05Bellamy035,
  op16EmporioIvankov026,
  op16MobyDick021,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-026 Emporio.Ivankov", () => {
  test("looks at 3, only [Impel Down] cards are revealable, the rest go to the deck bottom, then a cost-2 Character is played", () => {
    const engine = OnePieceTestEngine.create(
      {
        // op01Sai012 costs exactly 2 (on the line); op05Bellamy035 costs 3 (clear of it).
        hand: [op16EmporioIvankov026, op01Sai012, op05Bellamy035],
        deck: [op02Sphinx088, op03Namule007, op02Blugori084, op05Bellamy035],
        activeDon: 4,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const onTheLineId = engine.findCardInZone("south", "hand", op01Sai012);
    const overTheLineId = engine.findCardInZone("south", "hand", op05Bellamy035);
    const impelDownId = engine.findCardInZone("south", "deck", op02Sphinx088);
    const notImpelDownId = engine.findCardInZone("south", "deck", op03Namule007);
    const otherImpelDownId = engine.findCardInZone("south", "deck", op02Blugori084);
    const untouchedBottomId = engine.findCardInZone("south", "deck", op05Bellamy035);

    engine.playCard(op16EmporioIvankov026, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Ivankov's reveal choice.");
    // A search prompt lists every looked-at card with a per-candidate `legal` flag, so the
    // trait filter is asserted directly rather than by absence from the list.
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

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Ivankov's hand-play choice.");
    // The cost-4 card just revealed to hand is not a candidate either.
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([onTheLineId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(overTheLineId);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(impelDownId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [onTheLineId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(impelDownId);
    expect(view.players.south.characters.some((card) => card?.instanceId === onTheLineId)).toBe(
      true,
    );
    // The remainder lands BEHIND the card the search never looked at, in the chosen order.
    expect(engine.getState().players.south.deck).toEqual([
      untouchedBottomId,
      otherImpelDownId,
      notImpelDownId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #978: the hand-play still happens when nothing was added to hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16EmporioIvankov026, op01Sai012],
        // Not one [Impel Down] card among the three looked at.
        deck: [op03Namule007, op05Bellamy035, op03Namule007, op05Bellamy035],
        activeDon: 4,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const playableId = engine.findCardInZone("south", "hand", op01Sai012);

    engine.playCard(op16EmporioIvankov026, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected Ivankov's reveal choice.");
    expect(search.candidates.every((candidate) => candidate.legal === false)).toBe(true);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      {
        selectedIds: (() => {
          const step = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
          if (step?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
          return step.candidates.map((candidate) => candidate.ref.id);
        })(),
      },
      "south",
    );

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Ivankov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([playableId]);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [playableId] }, "south");
    expect(
      engine
        .getView("south")
        .players.south.characters.some((card) => card?.instanceId === playableId),
    ).toBe(true);
  });

  test("the hand-play is restricted to Character cards -- a cost-1 Stage does not qualify", () => {
    // It has to be a Stage, not an Event: candidatesForPlayAction (effects/actions.ts) already
    // pre-filters every `play` pool to character-or-stage before `cardCategory` is consulted.
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16EmporioIvankov026, op01Sai012, op16MobyDick021],
        deck: [op03Namule007, op05Bellamy035, op03Namule007, op05Bellamy035],
        activeDon: 4,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const playableId = engine.findCardInZone("south", "hand", op01Sai012);
    const stageId = engine.findCardInZone("south", "hand", op16MobyDick021);

    engine.playCard(op16EmporioIvankov026, "south");
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      {
        selectedIds: (() => {
          const step = engine.pendingDecision("effectSearchRemainderOrder", "south").steps[0];
          if (step?.kind !== "orderItems") throw new Error("Expected the bottom-deck ordering.");
          return step.candidates.map((candidate) => candidate.ref.id);
        })(),
      },
      "south",
    );

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Ivankov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([playableId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(stageId);
  });
});
