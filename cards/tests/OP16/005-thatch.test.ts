import { describe, expect, test } from "vite-plus/test";
import {
  op02DraculeMihawk055,
  op02Kingdew006,
  op02LittleoarsJr020,
  op02Thatch007,
  op16PortgasDAce001,
  op16Thatch005,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

function handCost(engine: OnePieceTestEngine): number | null {
  const card = engine
    .getView("south")
    .players.south.hand.find((entry) => entry.cardId === op16Thatch005.id);
  return card?.cost ?? null;
}

describe("OP16-005 Thatch", () => {
  test("a Whitebeard Pirates Character at exactly 8000 power discounts this card in hand by exactly 3", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16Thatch005],
        // op02Thatch007: 8000 power, ["Whitebeard Pirates"] -- the exact boundary body.
        character: [op02Thatch007],
      },
      {},
    );

    // Printed cost 8, minus 3. The magnitude is negative, so `mutation_check.py` never probes it
    // (its numeric operator only matches unsigned 3-6 digit values) -- pinned by hand here.
    expect(handCost(engine)).toBe(5);
  });

  test("neither an under-power Whitebeard Character nor an over-power non-Whitebeard one discounts it", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16Thatch005],
        character: [
          // 7000 and Whitebeard Pirates: fails the power half only. Deleting the power filter,
          // relaxing `gte 8000` to `lte 8000`, or dropping the threshold to 7000 all let this
          // body through.
          op02Kingdew006,
          // 8000 but "The Seven Warlords of the Sea": fails the trait half only. Deleting the
          // trait filter lets this body through.
          op02DraculeMihawk055,
        ],
      },
      {},
    );

    expect(handCost(engine)).toBe(8);
  });

  test("GENERAL ruling #39: a 9000-power [Whitebeard Pirates Allies] Character counts as the type", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16Thatch005],
        // "Giant Whitebeard Pirates Allies" -- `match: "includes"` is what makes this match, and
        // at 9000 it is clear of the boundary, so only `gte` (never `lte`) can accept it.
        character: [op02LittleoarsJr020],
      },
      {},
    );

    expect(handCost(engine)).toBe(5);
  });

  test("[Blocker] offers this Character as a block target on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op16PortgasDAce001, character: [op16Thatch005] },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ATTACKS,
    );
    const thatchId = engine.findCardInZone("south", "character", op16Thatch005);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    const block = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (block?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(block.candidates.map((candidate) => candidate.ref.id)).toContain(thatchId);
  });
});
