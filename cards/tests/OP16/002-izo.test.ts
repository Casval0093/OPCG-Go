import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op03MonkeyDLuffy070,
  op10TrafalgarLaw119,
  op16Izo002,
  op16Jozu007,
  op16Vista011,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-002 Izo", () => {
  test("ruling #962: only hand Characters at exactly 8000 power can pay the reveal cost, drawing a card", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Izo002, op03MonkeyDLuffy070, op16Jozu007, op16Vista011, op10TrafalgarLaw119],
        deck: [eb01Doma005],
        activeDon: op16Izo002.cost,
      },
      {},
    );
    // op03MonkeyDLuffy070: 7000 power -- under the printed "8000" reading as `gte`, this
    // would still (wrongly) qualify. Ruling #962 says "8000" means exactly 8000: `eq`.
    const underPowerId = engine.findCardInZone("south", "hand", op03MonkeyDLuffy070);
    // op16Jozu007 and op16Vista011: exactly 8000 power -- the only legal cost candidates.
    // Two of them so an ineligible-candidate assertion is actually exercised: with only one
    // legal candidate the engine auto-pays the cost without a selection prompt at all.
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op16Jozu007),
      engine.findCardInZone("south", "hand", op16Vista011),
    ];
    // op10TrafalgarLaw119: 9000 power -- over 8000, also excluded by `eq`.
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);

    engine.playCard(op16Izo002, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Izo's reveal payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...exactPowerIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overPowerId);
    engine.resolveDecision(
      "effectCostRevealFromHand",
      { selectedIds: [exactPowerIds[0]!] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(exactPowerIds[0]);
    const drawnId = engine.findCardInZone("south", "hand", eb01Doma005);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(drawnId);
    expect(view.prompts).toHaveLength(0);
  });

  test("declining the reveal draws no card, even with a payable 8000-power hand Character", () => {
    const engine = OnePieceTestEngine.create(
      {
        // A payable candidate must be present, or the cost can never be paid and the engine
        // never offers the activate/decline choice at all -- this test is specifically
        // about declining a choice that was actually available.
        hand: [op16Izo002, op16Jozu007],
        deck: [eb01Doma005],
        activeDon: op16Izo002.cost,
      },
      {},
    );
    const jozuId = engine.findCardInZone("south", "hand", op16Jozu007);

    engine.playCard(op16Izo002, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([jozuId]);
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });
});
