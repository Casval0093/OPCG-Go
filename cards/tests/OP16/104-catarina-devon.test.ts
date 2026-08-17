import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Hajrudin018,
  op01Sai012,
  op02Atmos003,
  op02Kingdew006,
  op09Fullalead099,
  op09Laffitte095,
  op09Stronger089,
  op09VascoShot091,
  op16CatarinaDevon104,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// Catarina is base 3000 and attacks a 6000-power body. Copying a 6000-power Character makes the
// attack connect (attackPower >= defensePower); declining leaves it at 3000 and the defender
// survives. That is what pins the MAGNITUDE of the copy -- a transient thisTurn modifier cannot be
// read back off the projection, because resolving the last prompt also finishes the battle and
// expires it.
function whenAttackingBoard() {
  return {
    south: {
      character: [{ card: op16CatarinaDevon104, playedOnTurn: 0 }, op01Sai012],
    },
    north: {
      // Active, cost 4, 6000 power -- the card to copy FROM.
      character: [op01Hajrudin018, { card: op02Atmos003, rested: true }],
    },
  };
}

describe("OP16-104 Catarina Devon", () => {
  test("[When Attacking] copying a 6000-power Character makes the 3000-power attack connect", () => {
    const board = whenAttackingBoard();
    const engine = OnePieceTestEngine.create(board.south, board.north, SOUTH_ATTACKS);
    const catarinaId = engine.findCardInZone("south", "character", op16CatarinaDevon104);
    const ownAllyId = engine.findCardInZone("south", "character", op01Sai012);
    const copySourceId = engine.findCardInZone("north", "character", op01Hajrudin018);
    const defenderId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(catarinaId, defenderId, "south");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected Catarina's copy choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [copySourceId, defenderId].sort(),
    );
    // "your opponent's Characters" -- neither south's own body nor north's Leader qualifies.
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(ownAllyId);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      engine.leader("north"),
    );

    engine.resolveDecision("effectTargetSelection", { selectedIds: [copySourceId] }, "south");

    expect(engine.getState().cards[defenderId]?.zone).toBe("trash");
  });

  test("[When Attacking] copying nothing leaves the 3000-power attack short", () => {
    const board = whenAttackingBoard();
    const engine = OnePieceTestEngine.create(board.south, board.north, SOUTH_ATTACKS);
    const catarinaId = engine.findCardInZone("south", "character", op16CatarinaDevon104);
    const defenderId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(catarinaId, defenderId, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    expect(engine.getState().cards[defenderId]?.zone).toBe("character");
  });

  test("[Trigger] draws 1, then plays only a cost-1 [Blackbeard Pirates] Character from the trash", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        life: [op16CatarinaDevon104, op01Sai012, op01Sai012, op01Sai012],
        trash: [
          // Cost 1, Blackbeard Pirates Characters -- the two legal candidates. Two of them so the
          // exclusions below are actually observable in a candidate list.
          op09Laffitte095,
          op09Stronger089,
          // Cost 2 Blackbeard Pirates Character -- excluded by `eq 1`, and it is what separates
          // `eq` from `gte`.
          op09VascoShot091,
          // Cost 1 but not Blackbeard Pirates -- excluded by the trait filter alone.
          eb01Doma005,
          // Cost 1 Blackbeard Pirates STAGE. It has to be a Stage, not an Event: a `play` action's
          // candidate pool is hard-filtered to stage-or-character before `cardCategory` is ever
          // consulted, so an Event fixture would "pass" without exercising the filter.
          op09Fullalead099,
        ],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const eligibleIds = [
      engine.findCardInZone("north", "trash", op09Laffitte095),
      engine.findCardInZone("north", "trash", op09Stronger089),
    ];
    const wrongCostId = engine.findCardInZone("north", "trash", op09VascoShot091);
    const wrongTraitId = engine.findCardInZone("north", "trash", eb01Doma005);
    const wrongCategoryId = engine.findCardInZone("north", "trash", op09Fullalead099);

    expect(engine.getView("north").players.north.hand).toHaveLength(0);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // The draw resolves before the play prompt, and the Trigger card itself goes to the trash
    // rather than joining the hand (GENERAL ruling #21), so this is exactly the one drawn card.
    expect(engine.getView("north").players.north.hand).toHaveLength(1);

    const play = engine.pendingDecision("effectPlaySelection", "north").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Catarina's trash-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...eligibleIds].sort(),
    );
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCostId);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongTraitId);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleIds[1]!] }, "north");

    expect(engine.getState().cards[eligibleIds[1]!]?.zone).toBe("character");
  });
});
