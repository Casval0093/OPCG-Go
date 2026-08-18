import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Atmos003,
  op03Genzo046,
  op03Merry052,
  op03Momoo035,
  op05Enel098,
  op15Jango026,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Deck fixtures are top-first.
//   op03Momoo035  traits ["Animal East Blue"] -- ONE concatenated string, so this is the only legal
//                 reveal AND the fixture that makes `match: "includes"` load-bearing: under
//                 `match: "exact"` nothing in the top 3 would be revealable at all.
//   op01Sai012    [Happosui Army]        -- not East Blue
//   op02Atmos003  [Whitebeard Pirates]   -- not East Blue
//   op03Merry052  [East Blue], 4th card  -- East Blue but out of reach, which is what pins
//                 lookCount at 3 rather than 4 or 5
const DECK = [op03Momoo035, op01Sai012, op02Atmos003, op03Merry052, op03Genzo046];

function jangoBoard(deck = DECK) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15Jango026], activeDon: 1, deck },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-026 Jango", () => {
  test("[On Play] looks at exactly 3, and only an [East Blue] card is revealable", () => {
    const engine = jangoBoard();
    const state = engine.getState();
    const [momooId, saiId, atmosId, merryId, genzoId] = state.players.south.deck;

    engine.playCard(op15Jango026, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected the search selection.");

    // `search` lists every card it looked at, with a per-candidate `legal` flag -- so the looked-at
    // set and the revealable set are two separate assertions.
    const lookedAt = search.candidates.map((candidate) => candidate.ref.id);
    expect(lookedAt).toEqual([momooId, saiId, atmosId]);
    expect(lookedAt).not.toContain(merryId);
    expect(lookedAt).not.toContain(genzoId);

    const legalIds = search.candidates
      .filter((candidate) => candidate.legal)
      .map((candidate) => candidate.ref.id);
    expect(legalIds).toEqual([momooId]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [momooId ?? ""] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [saiId ?? "", atmosId ?? ""] },
      "south",
    );

    // The revealed card is in hand; the two rejects are at the BOTTOM, behind the cards the search
    // never looked at. Asserting the whole deck array (not a slice) is what proves both the
    // remainder position and that Merry was never disturbed.
    expect(engine.findCardInZone("south", "hand", op03Momoo035)).toBe(momooId);
    expect(engine.getState().players.south.deck).toEqual([merryId, genzoId, saiId, atmosId]);
  });

  test('"up to 1" is a real up-to: with no [East Blue] in the top 3 nothing is added', () => {
    const engine = jangoBoard([op01Sai012, op02Atmos003, op01Sai012, op03Merry052, op03Genzo046]);
    const deckBefore = [...engine.getState().players.south.deck];
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15Jango026, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected the search selection.");
    expect(search.candidates.filter((candidate) => candidate.legal)).toHaveLength(0);
    expect(search.min).toBe(0);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [deckBefore[0] ?? "", deckBefore[1] ?? "", deckBefore[2] ?? ""] },
      "south",
    );

    // Playing Jango itself is what moved a card out of hand; nothing was added to it.
    expect(engine.getState().players.south.hand).toHaveLength(handBefore - 1);
    expect(engine.getState().players.south.deck).toEqual([
      deckBefore[3],
      deckBefore[4],
      deckBefore[0],
      deckBefore[1],
      deckBefore[2],
    ]);
  });
});
