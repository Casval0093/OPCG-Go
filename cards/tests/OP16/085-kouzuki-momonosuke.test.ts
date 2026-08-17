import { describe, expect, test } from "vite-plus/test";
import {
  eb01MountainGod018,
  op01Shinobu043,
  op02KouzukiOden030,
  op02LandOfWano048,
  op03Nero087,
  op10KouzukiMomonosuke083,
  op12KinEmon025,
  op16KouzukiMomonosuke085,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-085 Kouzuki Momonosuke", () => {
  test("plays only a non-Momonosuke Land of Wano Character card at cost 6 or less out of the trash", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16KouzukiMomonosuke085],
      trash: [
        // Eligible: cost 3 and cost 6 -- the second sits exactly on the printed line, which is
        // what pins the threshold rather than merely proving a filter exists.
        op01Shinobu043,
        op12KinEmon025,
        // Land of Wano at cost 8: excluded by the cost filter, and the body that separates
        // `lte 6` from `gte 6`.
        op02KouzukiOden030,
        // Cost 3, but CP9 rather than Land of Wano.
        op03Nero087,
        // Land of Wano at cost 2 -- excluded only by `excludeName`.
        op10KouzukiMomonosuke083,
        // A Land of Wano STAGE at cost 1. It must be a Stage, not an Event: a `play` action's
        // pool is pre-filtered to character-or-stage upstream, so an Event could never reach
        // the `cardCategory` filter and would make this assertion vacuous.
        op02LandOfWano048,
      ],
      activeDon: op16KouzukiMomonosuke085.cost,
    });
    const eligibleIds = [
      engine.findCardInZone("south", "trash", op01Shinobu043),
      engine.findCardInZone("south", "trash", op12KinEmon025),
    ];
    const overCostId = engine.findCardInZone("south", "trash", op02KouzukiOden030);
    const wrongTraitId = engine.findCardInZone("south", "trash", op03Nero087);
    const sameNameId = engine.findCardInZone("south", "trash", op10KouzukiMomonosuke083);
    const stageId = engine.findCardInZone("south", "trash", op02LandOfWano048);

    engine.playCard(op16KouzukiMomonosuke085, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Momonosuke's play choice.");
    expect(play).toMatchObject({ min: 0, max: 1 });
    const ids = play.candidates.map((candidate) => candidate.ref.id);
    expect(ids.sort()).toEqual([...eligibleIds].sort());
    expect(ids).not.toContain(overCostId);
    expect(ids).not.toContain(wrongTraitId);
    expect(ids).not.toContain(sameNameId);
    expect(ids).not.toContain(stageId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleIds[0]!] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(
      eligibleIds[0],
    );
    expect(view.players.south.trash.map((card) => card.instanceId)).not.toContain(eligibleIds[0]);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Blocker] can redirect an attack onto itself", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: eb01MountainGod018, playedOnTurn: 0 }] },
      { character: [op16KouzukiMomonosuke085] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", eb01MountainGod018);
    const momonosukeId = engine.findCardInZone("north", "character", op16KouzukiMomonosuke085);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Momonosuke's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(momonosukeId);
    engine.resolveDecision("battleBlocker", { selectedIds: [momonosukeId] }, "north");

    const view = engine.getView("north");
    // 7000 attacker vs 6000 blocker: the Leader took nothing and the blocker died in its place.
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(momonosukeId);
  });
});
