import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Sai012,
  op02Kingdew006,
  op02Thatch007,
  op03Camie101,
  op03Genzo046,
  op03MonkeyDLuffy070,
  op16PortgasDAce001,
  op16PortgasDAce118,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// The deck is ordered so that each of the two disjuncts has a card only IT accepts, and the 6th
// card -- a [Whitebeard Pirates] body that would obviously qualify -- sits just past lookCount.
//
//   1 Sai                 Happosui Army             ineligible
//   2 Monkey.D.Luffy      Straw Hat Crew Water Seven eligible by NAME only
//   3 Thatch              Whitebeard Pirates         eligible by TRAIT only
//   4 Genzo               East Blue                  ineligible
//   5 Doma                Whitebeard Pirates Allies  eligible by trait, via `match: "includes"`
//   6 Kingdew             Whitebeard Pirates         never looked at -- this is what pins lookCount
//   7 Camie               Merfolk                    never looked at
function deck() {
  return [
    op01Sai012,
    op03MonkeyDLuffy070,
    op02Thatch007,
    op03Genzo046,
    eb01Doma005,
    op02Kingdew006,
    op03Camie101,
  ];
}

describe("OP16-118 Portgas.D.Ace", () => {
  test("[On Play] looks at exactly 5 and offers only [Monkey.D.Luffy] or a [Whitebeard Pirates] type", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16PortgasDAce118],
        deck: deck(),
        activeDon: op16PortgasDAce118.cost,
      },
      {},
    );
    const [first, luffy, thatch, genzo, doma, sixth, seventh] = engine.getState().players.south
      .deck as [string, string, string, string, string, string, string];

    engine.playCard(op16PortgasDAce118, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Ace's look-at-5.");
    // A search prompt lists every card it looked at and marks each legal or not, so exclusions
    // must be asserted through `legal` -- `not.toContain` on the ids passes vacuously here.
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      first,
      luffy,
      thatch,
      genzo,
      doma,
    ]);
    const legalOf = (id: string) =>
      look.candidates.find((candidate) => candidate.ref.id === id)?.legal;
    expect(legalOf(first)).toBe(false);
    // Name-only: still legal, which is what dies if the `name` filter is deleted.
    expect(legalOf(luffy)).toBe(true);
    // Trait-only: still legal, which is what dies if the `trait` filter is deleted.
    expect(legalOf(thatch)).toBe(true);
    expect(legalOf(genzo)).toBe(false);
    expect(legalOf(doma)).toBe(true);
    // The 6th card is a plain [Whitebeard Pirates] body and was never looked at: only lookCount
    // keeps it out.
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixth);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [luffy] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [doma, genzo, thatch, first] },
      "south",
    );

    const state = engine.getState();
    expect(state.players.south.hand).toContain(luffy);
    // The remainder lands at the BOTTOM, behind the two cards the search never looked at.
    expect(state.players.south.deck).toEqual([sixth, seventh, doma, genzo, thatch, first]);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[On K.O.] runs the same search when this Character is K.O.'d in battle", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [{ card: op16PortgasDAce118, rested: true }],
        deck: deck(),
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ATTACKS,
    );
    const aceId = engine.findCardInZone("south", "character", op16PortgasDAce118);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);
    const [first, luffy, thatch, genzo, doma, sixth] = engine.getState().players.south.deck as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    // Ace is 6000, the attacker 8000.
    engine.declareAttack(attackerId, aceId, "north");
    expect(engine.getState().cards[aceId]?.zone).toBe("trash");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Ace's [On K.O.] look-at-5.");
    // [On Play]/[On K.O.] is two blocks with two independent copies of every filter, so the
    // [On Play] test above pins none of these: both disjuncts and lookCount are re-asserted here.
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      first,
      luffy,
      thatch,
      genzo,
      doma,
    ]);
    const legalOf = (id: string) =>
      look.candidates.find((candidate) => candidate.ref.id === id)?.legal;
    expect(legalOf(first)).toBe(false);
    expect(legalOf(luffy)).toBe(true);
    expect(legalOf(thatch)).toBe(true);
    expect(legalOf(genzo)).toBe(false);
    expect(legalOf(doma)).toBe(true);
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixth);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [thatch] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [luffy, genzo, doma, first] },
      "south",
    );

    expect(engine.getState().players.south.hand).toContain(thatch);
  });

  test("[On Play] with nothing eligible in the top 5 still lets the whole look-at happen", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16PortgasDAce118],
        deck: [op01Sai012, op03Genzo046, op03Camie101, op01Sai012, op03Genzo046, op02Thatch007],
        activeDon: op16PortgasDAce118.cost,
      },
      {},
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op16PortgasDAce118, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Ace's look-at-5.");
    expect(look.candidates.every((candidate) => candidate.legal === false)).toBe(true);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: deckBefore.slice(0, 5) },
      "south",
    );

    expect(engine.getView("south").players.south.hand).toHaveLength(0);
    // The 6th card stays on top; the five looked-at cards go under it in the chosen order.
    expect(engine.getState().players.south.deck).toEqual([
      deckBefore[5],
      ...deckBefore.slice(0, 5),
    ]);
  });
});
