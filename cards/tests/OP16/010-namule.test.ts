import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op03Fossa010,
  op10TrafalgarLaw119,
  op16Namule010,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-010-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-010-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

// 2000 base power sitting at 5000 current power. The K.O. prints 原本的力量 (base power), so this
// body IS a legal target; a `power lte 2000` encoding would spare it. `mutation_check.py` never
// swaps `basePower` for `power`, so this is the hand-written half of that boundary.
const twoThousandBaseAtFive: CharacterCard = {
  ...op03Fossa010,
  id: "TEST-OP16-010-2000-BASE-AT-5000",
  canonicalId: "TEST-OP16-010-2000-BASE-AT-5000",
  name: "Test 2000-Base Body At 5000 Power",
  i18n: { en: { ...op03Fossa010.i18n.en, name: "Test 2000-Base Body At 5000 Power" } },
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 3000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([eightThousandPowerLeader, twoThousandBaseAtFive]);

describe("OP16-010 Namule", () => {
  test("ruling #968: reveal a hand Character at exactly 8000 power, K.O. an opponent Character with 2000 BASE power or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [
          op16Namule010,
          op02Thatch007,
          op02DraculeMihawk055,
          op02Kingdew006,
          op10TrafalgarLaw119,
          eightThousandPowerLeader,
        ],
        activeDon: op16Namule010.cost,
      },
      {
        character: [
          // 2000 base -- the on-the-line target
          op03Fossa010,
          twoThousandBaseAtFive,
          // 3000 base -- the only body the filter itself excludes
          eb01Doma005,
        ],
      },
    );
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op02Thatch007),
      engine.findCardInZone("south", "hand", op02DraculeMihawk055),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op02Kingdew006);
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);
    const wrongCategoryId = engine.findCardInZone("south", "hand", eightThousandPowerLeader);
    const boundaryId = engine.findCardInZone("north", "character", op03Fossa010);
    const buffedId = engine.findCardInZone("north", "character", twoThousandBaseAtFive);
    const tooStrongId = engine.findCardInZone("north", "character", eb01Doma005);

    expect(
      engine
        .getView("south")
        .players.north.characters.find((entry) => entry?.instanceId === buffedId)?.power,
    ).toBe(5000);

    engine.playCard(op16Namule010, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Namule's reveal payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...exactPowerIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);
    engine.resolveDecision(
      "effectCostRevealFromHand",
      { selectedIds: [exactPowerIds[0]!] },
      "south",
    );

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Namule's K.O. target choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, buffedId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooStrongId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buffedId] }, "south");

    const state = engine.getState();
    expect(state.cards[buffedId]?.zone).toBe("trash");
    expect(state.cards[boundaryId]?.zone).toBe("character");
    expect(state.cards[tooStrongId]?.zone).toBe("character");
    // The reveal is not a discard: the revealed card is still in hand.
    expect(state.players.south.hand).toContain(exactPowerIds[0]);
  });

  test("declining the reveal K.O.s nothing", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16Namule010, op02Thatch007], activeDon: op16Namule010.cost },
      { character: [op03Fossa010] },
    );
    const survivorId = engine.findCardInZone("north", "character", op03Fossa010);

    engine.playCard(op16Namule010, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().cards[survivorId]?.zone).toBe("character");
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
