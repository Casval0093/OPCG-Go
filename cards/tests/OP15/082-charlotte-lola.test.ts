import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Thatch007,
  op04Barrier095,
  op05JohnGiant044,
  op06GeckoMoria080,
  op15CharlotteLola082,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The vanilla pool tops out at cost 8, so the "8 or less" boundary needs a synthetic twin one
// step over the line. Right about everything except its cost.
const costNine: CharacterCard = {
  ...op05JohnGiant044,
  id: "TEST-OP15-082-COST-9",
  canonicalId: "TEST-OP15-082-COST-9",
  cost: 9,
  effects: undefined,
};

registerCards([costNine]);

const NORTH_ACTS = { firstPlayer: "south", activeSeat: "north" } as const;

describe("OP15-082 Charlotte Lola", () => {
  test("the [On Play] mills exactly 3", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op06GeckoMoria080, hand: [op15CharlotteLola082], deck: 20, activeDon: 5 },
      {},
    );

    engine.playCard(op15CharlotteLola082, "south");

    expect(engine.getState().players.south.deck).toHaveLength(17);
    expect(engine.getState().players.south.trash).toHaveLength(3);
  });

  test("ruling #922: the [On K.O.] may add THIS card itself, and the filters really bite", () => {
    // 可以 -- Lola is cost 4 and is already in the trash when her own [On K.O.] resolves.
    // The three other cards in the trash each break exactly one filter and nothing else:
    // John Giant is the on-the-line cost 8 (a `lte -> gte` mutation drops Lola herself),
    // `costNine` is one step over (kills `delete filter:cost`), and Barrier is an Event whose
    // cost of 1 passes the cost filter (kills `delete filter:cardCategory` -- a `returnToHand`
    // over the trash has no card-type pre-filter, unlike a `play` action).
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        character: [{ card: op15CharlotteLola082, rested: true }],
        trash: [op05JohnGiant044, costNine, op04Barrier095],
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ACTS,
    );
    const lolaId = engine.findCardInZone("south", "character", op15CharlotteLola082);
    const johnGiantId = engine.findCardInZone("south", "trash", op05JohnGiant044);
    const costNineId = engine.findCardInZone("south", "trash", costNine);
    const barrierId = engine.findCardInZone("south", "trash", op04Barrier095);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      lolaId,
      "north",
    );

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected Lola's trash selection.");
    const candidateIds = step.candidates.map((candidate) => candidate.ref.id);

    expect([...candidateIds].sort()).toEqual([johnGiantId, lolaId].sort());
    expect(candidateIds).not.toContain(costNineId);
    expect(candidateIds).not.toContain(barrierId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [lolaId] }, "south");

    expect(engine.getState().cards[lolaId]?.zone).toBe("hand");
  });
});
