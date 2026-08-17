import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02KinEmon025,
  op04Yamato112,
  op10KouzukiMomonosuke083,
  op16KouzukiMomonosuke084,
  op16KouzukiMomonosuke085,
  op16Shinobu087,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// No printed [Kouzuki Momonosuke] costs 10 or more, so the only way to show that "with a cost
// of 9" is an equality rather than a floor is a synthetic printing. Name and traits are spread
// from OP16-085 unchanged, so `i18n.en.name` already agrees with the `name` filter -- only the
// cost differs.
const tenCostMomonosuke: CharacterCard = {
  ...op16KouzukiMomonosuke085,
  id: "TEST-OP16-084-MOMONOSUKE-COST-10",
  canonicalId: "TEST-OP16-084-MOMONOSUKE-COST-10",
  cost: 10,
};

registerCards([tenCostMomonosuke]);

describe("OP16-084 Kouzuki Momonosuke", () => {
  test("ruling #1004: at the printed cost of 5 the activation is illegal, DON!! notwithstanding", () => {
    const engine = OnePieceTestEngine.create({
      character: [op16KouzukiMomonosuke084],
      trash: [op16KouzukiMomonosuke085],
      // 10 DON!! on the field: the other half of the condition is comfortably satisfied, so the
      // rejection can only be the cost gate.
      activeDon: 10,
    });
    const momonosukeId = engine.findCardInZone("south", "character", op16KouzukiMomonosuke084);

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: momonosukeId,
        trigger: "activateMain",
      }).reason,
    ).toContain("The activation conditions are not met.");
    expect(engine.getView("south").players.south.trash).toHaveLength(1);
  });

  test("buffed to cost 25 with 10 DON!! on the field, trashes itself and plays only the cost-9 Momonosuke", () => {
    const engine = OnePieceTestEngine.create({
      // Shinobu's own +20 needs a [Land of Wano] Leader.
      leaderCardId: op02KinEmon025,
      character: [op16KouzukiMomonosuke084],
      hand: [op16Shinobu087],
      deck: [eb01Doma005, eb01Doma005],
      trash: [
        // The one legal choice: cost exactly 9, named Kouzuki Momonosuke.
        op16KouzukiMomonosuke085,
        // Cost 10 -- right name, over the line. Legal only under a `gte` misreading.
        tenCostMomonosuke,
        // Cost 2 -- right name, under the line. Legal only if the cost filter is dropped.
        op10KouzukiMomonosuke083,
        // Cost 9 -- right cost, wrong name. Legal only if the name filter is dropped.
        op04Yamato112,
      ],
      // 10, so that after Shinobu's cost is paid the field still holds 10 DON!! -- one clear
      // step past the printed 9, which is what separates `gte 9` from `lte 9`.
      activeDon: 10,
    });
    const momonosukeId = engine.findCardInZone("south", "character", op16KouzukiMomonosuke084);
    const eligibleId = engine.findCardInZone("south", "trash", op16KouzukiMomonosuke085);
    const overCostId = engine.findCardInZone("south", "trash", tenCostMomonosuke);
    const underCostId = engine.findCardInZone("south", "trash", op10KouzukiMomonosuke083);
    const wrongNameId = engine.findCardInZone("south", "trash", op04Yamato112);

    // OP16-087 Shinobu: trash itself, draw 1, and give one [Kouzuki Momonosuke] +20 cost.
    engine.playCard(op16Shinobu087, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [momonosukeId] }, "south");
    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === momonosukeId)?.cost,
    ).toBe(25);
    expect(
      engine.getState().players.south.activeDon + engine.getState().players.south.restedDon,
    ).toBe(10);

    engine.activateEffect(momonosukeId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Momonosuke's play choice.");
    expect(play).toMatchObject({ min: 0, max: 1 });
    const ids = play.candidates.map((candidate) => candidate.ref.id);
    expect(ids).toEqual([eligibleId]);
    expect(ids).not.toContain(overCostId);
    expect(ids).not.toContain(underCostId);
    expect(ids).not.toContain(wrongNameId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleId] }, "south");
    // OP16-085's own [On Play] fires as it enters -- decline it, it is not what this test is
    // about (see cards/tests/OP16/085-kouzuki-momonosuke.test.ts).
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    // The cost was paid: the cost-5 printing left the field for the trash...
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(momonosukeId);
    // ...and the cost-9 printing took its place.
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(eligibleId);
    expect(view.prompts).toHaveLength(0);
  });

  test("at cost 25 but only 8 DON!! on the field, the activation is still illegal", () => {
    const engine = OnePieceTestEngine.create({
      leaderCardId: op02KinEmon025,
      character: [op16KouzukiMomonosuke084],
      hand: [op16Shinobu087],
      deck: [eb01Doma005, eb01Doma005],
      trash: [op16KouzukiMomonosuke085],
      // 8 after Shinobu is paid for: one step under the printed 9. A `gte 8` encoding would
      // wrongly allow this, and mutation_check.py does not perturb single-digit thresholds.
      activeDon: 8,
    });
    const momonosukeId = engine.findCardInZone("south", "character", op16KouzukiMomonosuke084);

    engine.playCard(op16Shinobu087, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [momonosukeId] }, "south");
    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === momonosukeId)?.cost,
    ).toBe(25);

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: momonosukeId,
        trigger: "activateMain",
      }).reason,
    ).toContain("The activation conditions are not met.");
  });
});
