import { describe, expect, test } from "vite-plus/test";
import {
  eb01Fourtricks025,
  op01Shinobu043,
  op02KouzukiOden030,
  op02LandOfWano048,
  op03Alvida023,
  op03EniesLobby098,
  op03Jerry084,
  op03Nero087,
  op12KinEmon025,
  op16Yamato097,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-097 Yamato", () => {
  test("recovers a Land of Wano Character at cost 6 or less, then plays a Character at cost 2 or less", () => {
    const engine = OnePieceTestEngine.create({
      hand: [
        op16Yamato097,
        // Play-from-hand candidates: cost 1 and cost 2 (exactly on that clause's line) are legal;
        // eb01Fourtricks025 at cost 3 is one step over and separates `lte 2` from `gte 2`.
        op03Alvida023,
        op03Jerry084,
        eb01Fourtricks025,
        // A cost-2 STAGE. A `play` action's pool is pre-filtered to character-or-stage, so only a
        // Stage can exercise `cardCategory` there -- an Event would make the assertion vacuous.
        op03EniesLobby098,
      ],
      trash: [
        // Recovery candidates: cost 3 and cost 6 (exactly on the line) are legal.
        op01Shinobu043,
        op12KinEmon025,
        // Land of Wano at cost 8: separates `lte 6` from `gte 6`.
        op02KouzukiOden030,
        // Cost 3 but CP9, not Land of Wano.
        op03Nero087,
        // A Land of Wano STAGE at cost 1. Unlike the `play` action below, `returnToHand`'s pool
        // is the whole trash with no card-type pre-filter, so `cardCategory` is doing real work
        // on this half too.
        op02LandOfWano048,
      ],
      activeDon: op16Yamato097.cost,
    });
    const recoverableIds = [
      engine.findCardInZone("south", "trash", op01Shinobu043),
      engine.findCardInZone("south", "trash", op12KinEmon025),
    ];
    const overCostTrashId = engine.findCardInZone("south", "trash", op02KouzukiOden030);
    const wrongTraitTrashId = engine.findCardInZone("south", "trash", op03Nero087);
    const trashStageId = engine.findCardInZone("south", "trash", op02LandOfWano048);
    const playableIds = [
      engine.findCardInZone("south", "hand", op03Alvida023),
      engine.findCardInZone("south", "hand", op03Jerry084),
    ];
    const overCostHandId = engine.findCardInZone("south", "hand", eb01Fourtricks025);
    const handStageId = engine.findCardInZone("south", "hand", op03EniesLobby098);

    engine.playCard(op16Yamato097, "south");

    const recover = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(recover?.kind).toBe("selectEntity");
    if (recover?.kind !== "selectEntity") throw new Error("Expected Yamato's trash recovery.");
    expect(recover).toMatchObject({ min: 0, max: 1 });
    const recoverIds = recover.candidates.map((candidate) => candidate.ref.id);
    expect(recoverIds.sort()).toEqual([...recoverableIds].sort());
    expect(recoverIds).not.toContain(overCostTrashId);
    expect(recoverIds).not.toContain(wrongTraitTrashId);
    expect(recoverIds).not.toContain(trashStageId);
    // op01Shinobu043 costs 3, so the card just added to hand is deliberately NOT also a
    // play-from-hand candidate -- that keeps the next assertion's expected list exact.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [recoverableIds[0]!] }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Yamato's play-from-hand choice.");
    expect(play).toMatchObject({ min: 0, max: 1 });
    const playIds = play.candidates.map((candidate) => candidate.ref.id);
    expect(playIds.sort()).toEqual([...playableIds].sort());
    expect(playIds).not.toContain(overCostHandId);
    expect(playIds).not.toContain(handStageId);
    expect(playIds).not.toContain(recoverableIds[0]);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [playableIds[1]!] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(recoverableIds[0]);
    expect(view.players.south.trash.map((card) => card.instanceId)).not.toContain(
      recoverableIds[0],
    );
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(playableIds[1]);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #1007: with nothing recoverable in the trash, the play-from-hand half still happens", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16Yamato097, op03Alvida023, op03Jerry084],
      // Only an ineligible card in the trash: cost 8, so the first clause has no legal target and
      // publishes no prompt at all (GENERAL ruling #27).
      trash: [op02KouzukiOden030],
      activeDon: op16Yamato097.cost,
    });
    const unreachableId = engine.findCardInZone("south", "trash", op02KouzukiOden030);
    const playableId = engine.findCardInZone("south", "hand", op03Alvida023);

    engine.playCard(op16Yamato097, "south");

    // 可以 -- the "Then" half is not conditional on the first half having done anything. Nesting
    // the `play` in the recovery's `thenActions` would get this ruling backwards.
    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (play?.kind !== "selectEntity") throw new Error("Expected Yamato's play-from-hand choice.");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [playableId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(playableId);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(unreachableId);
    expect(view.prompts).toHaveLength(0);
  });
});
