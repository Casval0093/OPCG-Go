import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb01Fourtricks025,
  op04Yamato112,
  op12Issho082,
  op16Yamato096,
  op16Yamato097,
  op16Yamato098,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #1008 rules out both sides of 8, and the printed pool cannot show either side: every
// black [Yamato] is cost 6 or 8, and no [Yamato] outside black is cost 8. Two synthetic
// printings supply the missing corners. Both spread a real Yamato, so `name` and `i18n.en.name`
// already agree -- only the field under test differs.
const blackYamatoCostNine: CharacterCard = {
  ...op16Yamato096,
  id: "TEST-OP16-098-YAMATO-BLACK-COST-9",
  canonicalId: "TEST-OP16-098-YAMATO-BLACK-COST-9",
  cost: 9,
};

const yellowYamatoCostEight: CharacterCard = {
  ...op04Yamato112,
  id: "TEST-OP16-098-YAMATO-YELLOW-COST-8",
  canonicalId: "TEST-OP16-098-YAMATO-YELLOW-COST-8",
  cost: 8,
};

registerCards([blackYamatoCostNine, yellowYamatoCostEight]);

describe("OP16-098 Yamato", () => {
  test("[On Play] draws 1 and trashes 1 of your own choosing", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16Yamato098, eb01Doma005],
      deck: [eb01Fourtricks025, eb01Doma005],
      activeDon: op16Yamato098.cost,
    });
    const retainedId = engine.findCardInZone("south", "hand", eb01Doma005);
    const drawnId = engine.findCardInZone("south", "deck", eb01Fourtricks025);

    engine.playCard(op16Yamato098, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Yamato's hand-trash choice.");
    expect(trash).toMatchObject({ min: 1, max: 1 });
    expect(trash.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [retainedId, drawnId].sort(),
    );
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [drawnId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([retainedId]);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual([drawnId]);
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #1008: trashes itself to revive a black [Yamato] at exactly cost 8 -- not 6, not 9, not another colour", () => {
    const engine = OnePieceTestEngine.create({
      character: [op16Yamato098],
      trash: [
        // Legal: black, named Yamato, cost exactly 8. Two of them, so the ineligible candidates
        // are genuinely observable in the prompt.
        op16Yamato096,
        op16Yamato097,
        // Black Yamato at cost 6 -- 不能. Only the cost filter excludes it.
        op16Yamato098,
        // Black Yamato at cost 9 -- 不能. Excluded by `eq` and admitted by `gte`.
        blackYamatoCostNine,
        // Yamato at cost 8 but yellow -- excluded by the colour filter alone.
        yellowYamatoCostEight,
        // Black at cost 8 but not a Yamato -- excluded by the name filter alone.
        op12Issho082,
      ],
    });
    const yamato098Id = engine.findCardInZone("south", "character", op16Yamato098);
    const eligibleIds = [
      engine.findCardInZone("south", "trash", op16Yamato096),
      engine.findCardInZone("south", "trash", op16Yamato097),
    ];
    const underCostId = engine.findCardInZone("south", "trash", op16Yamato098);
    const overCostId = engine.findCardInZone("south", "trash", blackYamatoCostNine);
    const wrongColorId = engine.findCardInZone("south", "trash", yellowYamatoCostEight);
    const wrongNameId = engine.findCardInZone("south", "trash", op12Issho082);

    engine.activateEffect(yamato098Id, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Yamato's revival choice.");
    const ids = play.candidates.map((candidate) => candidate.ref.id);
    expect(ids.sort()).toEqual([...eligibleIds].sort());
    expect(ids).not.toContain(underCostId);
    expect(ids).not.toContain(overCostId);
    expect(ids).not.toContain(wrongColorId);
    expect(ids).not.toContain(wrongNameId);
    // This card has itself just been trashed to pay the cost, and is another black cost-6
    // [Yamato] in that trash -- the same exclusion as underCostId, reached the other way.
    expect(ids).not.toContain(yamato098Id);
    // OP16-096 has no [On Play], so the revival is directly observable with nothing cascading.
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleIds[0]!] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(eligibleIds[0]);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(yamato098Id);
    expect(view.prompts).toHaveLength(0);
  });

  test("declining the self-trash leaves Yamato on the field and the trash untouched", () => {
    const engine = OnePieceTestEngine.create({
      character: [op16Yamato098],
      trash: [op16Yamato096, op16Yamato097],
    });
    const yamato098Id = engine.findCardInZone("south", "character", op16Yamato098);

    engine.activateEffect(yamato098Id, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(yamato098Id);
    expect(view.players.south.trash).toHaveLength(2);
    expect(view.prompts).toHaveLength(0);
  });
});
