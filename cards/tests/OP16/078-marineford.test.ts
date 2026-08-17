import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op02Doberman107,
  op02Komille097,
  op03Namule007,
  op16Marineford078,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Fixtures are genuinely vanilla pre-OP15 cards. op02Komille097 and op02Doberman107 carry the
// "Navy" trait; op03Namule007, op02Atmos003 and eb01Doma005 do not. The Leader
// (op16PortgasDAce001, [Activate: Main] only) is irrelevant to this card and merely inert -- and
// deliberately NOT a Navy Leader such as OP12-040 Kuzan, whose own
// [When cards are trashed from your hand by an effect] ability would fire off the
// [Activate: Main]'s trash and add prompts that have nothing to do with this card.

describe("OP16-078 Marineford", () => {
  test("[On Play] looks at 5 and only a [Navy] type card may be taken", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16Marineford078],
        deck: [
          op02Komille097,
          op03Namule007,
          op02Doberman107,
          op02Atmos003,
          eb01Doma005,
          op03Namule007,
        ],
        activeDon: 1,
      },
      {},
    );
    const [komilleId, namuleId, dobermanId, atmosId, domaId, sixthId] = engine.getState().players
      .south.deck as [string, string, string, string, string, string];

    engine.playCard(op16Marineford078, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(look?.kind).toBe("selectEntity");
    if (look?.kind !== "selectEntity") throw new Error("Expected Marineford's look-at-5.");
    // A filtered search shows every looked-at card and marks which ones qualify, rather than
    // hiding the rest -- so the trait filter is directly observable as the `legal` flag.
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([komilleId, dobermanId]);
    expect(
      look.candidates.filter((candidate) => !candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([namuleId, atmosId, domaId]);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [dobermanId] }, "south");

    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [komilleId, namuleId, atmosId, domaId] },
      "south",
    );

    const state = engine.getState();
    expect(state.players.south.hand).toContain(dobermanId);
    // The remainder goes to the bottom, behind the 6th card the search never looked at.
    expect(state.players.south.deck).toEqual([sixthId, komilleId, namuleId, atmosId, domaId]);
  });

  test("[Activate: Main] returns 1 DON!! and rests the Stage to draw 1 and trash 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        stage: op16Marineford078,
        hand: [op03Namule007],
        deck: [op02Komille097, op02Atmos003, eb01Doma005, op03Namule007, eb01Doma005],
        activeDon: 2,
        donDeckCount: 8,
      },
      {},
    );
    const stageId = engine.findCardInZone("south", "stage", op16Marineford078);
    const handId = engine.findCardInZone("south", "hand", op03Namule007);
    const drawnId = engine.getState().players.south.deck[0]!;

    engine.activateEffect(stageId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected the post-draw trash choice.");
    // The draw resolves before the trash, so the freshly drawn card is itself discardable.
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toEqual([handId, drawnId]);
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [drawnId] }, "south");

    const state = engine.getState();
    expect(state.players.south.hand).toEqual([handId]);
    expect(state.players.south.trash).toContain(drawnId);
    // DON!! -1 really is paid to the DON!! deck, and the Stage is rested rather than trashed.
    expect(state.players.south.activeDon).toBe(1);
    expect(state.players.south.donDeckCount).toBe(9);
    expect(state.players.south.stageArea).toBe(stageId);
    expect(state.cards[stageId]?.rested).toBe(true);
  });
});
