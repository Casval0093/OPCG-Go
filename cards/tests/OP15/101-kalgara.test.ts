import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op03Namule007,
  op05Enel098,
  op06Genbo105,
  op08MontBlancNoland109,
  op15Kalgara101,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The two halves of the printed "or" are deliberately split across two fixtures that each match
// only one of them:
//   op08MontBlancNoland109  name "Mont Blanc Noland", traits ["Jaya Botanist"]      -> NAME only
//   op06Genbo105            name "Genbo", traits ["Sky Island Shandian Warrior"]    -> TRAIT only
// so deleting either filter from the `anyOf` drops exactly one card out of the legal set.
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

describe("OP15-101 Kalgara", () => {
  test("[On Play] looks at 5 and may take both a [Mont Blanc Noland] and a [Shandian Warrior]", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        // Two spare cards, not one: a cost whose candidate pool has exactly `amount` entries
        // auto-pays and publishes no prompt at all.
        hand: [op15Kalgara101, op01Sai012, op03Namule007],
        deck: [
          op08MontBlancNoland109,
          op06Genbo105,
          op01Sai012,
          op01Sai012,
          op01Sai012,
          // Never looked at: the remainder is placed BEHIND these, so the deck order after the
          // effect is the untouched tail first and the three rejected cards after it.
          op03Namule007,
          op03Namule007,
          op03Namule007,
        ],
        activeDon: 3,
      },
      {},
      SOUTH_ACTS,
    );
    const deckBefore = [...engine.getState().players.south.deck];
    const [nolandId, genboId, ...rest] = deckBefore;
    const lookedAtRejects = rest.slice(0, 3);
    const untouchedTail = rest.slice(3);

    engine.playCard(op15Kalgara101, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected a cost payment step.");
    // The cost carries no filter -- "1 card from your hand", any card. Both spares are payable.
    expect(payment.candidates).toHaveLength(2);
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [payment.candidates[0]?.ref.id ?? ""] },
      "south",
    );

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected a search selection.");
    // `lookCount: 5` is a single digit and so is invisible to the mutation checker -- pin it by
    // hand. All five are listed; only two carry `legal`.
    expect(search.candidates).toHaveLength(5);
    const legalIds = search.candidates
      .filter((candidate) => candidate.legal)
      .map((candidate) => candidate.ref.id);
    expect(legalIds.sort()).toEqual([nolandId, genboId].sort());

    engine.resolveDecision(
      "effectSearchSelection",
      { selectedIds: [nolandId ?? "", genboId ?? ""] },
      "south",
    );
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: lookedAtRejects.filter((id): id is string => id !== undefined) },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[nolandId ?? ""]?.zone).toBe("hand");
    expect(state.cards[genboId ?? ""]?.zone).toBe("hand");
    // Three cards were rejected and all three went to the bottom -- nothing was trashed.
    expect(state.players.south.deck).toEqual([...untouchedTail, ...lookedAtRejects]);
  });

  test("only the [Mont Blanc Noland] NAME qualifies it -- it carries no Shandian Warrior trait", () => {
    // If the `name` filter were written as a trait (or dropped), OP08-109 stops being legal:
    // its traits are ["Jaya Botanist"] and no card anywhere carries a "Mont Blanc Noland" trait.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        hand: [op15Kalgara101, op01Sai012],
        deck: [op08MontBlancNoland109, op01Sai012, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
        activeDon: 3,
      },
      {},
      SOUTH_ACTS,
    );
    const nolandId = engine.getState().players.south.deck[0];

    engine.playCard(op15Kalgara101, "south");
    // One spare card in hand, so the cost auto-pays with no prompt of its own.
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected a search selection.");
    expect(
      search.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([nolandId]);
  });

  test("with an empty hand the cost cannot be paid and the whole effect is never offered", () => {
    const engine = OnePieceTestEngine.create(
      // Kalgara is the only card in hand, so playing it empties the hand before the [On Play]
      // resolves -- `canPayCosts` then suppresses the confirm entirely.
      { leaderCardId: op05Enel098, hand: [op15Kalgara101], deck: 10, activeDon: 3 },
      {},
      SOUTH_ACTS,
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op15Kalgara101, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.deck).toEqual(deckBefore);
    expect(engine.getState().players.south.hand).toHaveLength(0);
  });
});
