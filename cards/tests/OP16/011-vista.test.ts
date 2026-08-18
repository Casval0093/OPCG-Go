import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Atmos003,
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op03Izo003,
  op03Thatch005,
  op10TrafalgarLaw119,
  op16PortgasDAce001,
  op16Vista011,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-011-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-011-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

// 2000 base power sitting at 5000 current power: a legal K.O. target under the printed
// 原本的力量 (base power), and spared under a `power` encoding.
const twoThousandBaseAtFive: CharacterCard = {
  ...op03Thatch005,
  id: "TEST-OP16-011-2000-BASE-AT-5000",
  canonicalId: "TEST-OP16-011-2000-BASE-AT-5000",
  name: "Test 2000-Base Body At 5000 Power",
  i18n: { en: { ...op03Thatch005.i18n.en, name: "Test 2000-Base Body At 5000 Power" } },
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

// op03Thatch005 and op03Izo003 are both 2000-power bodies whose only abilities are an
// [Activate:Main] and an [On Play] -- inert once sitting on the field, and neither is a
// [Blocker], so no blocker step interposes before the [When Attacking] effect resolves.
function northBoard() {
  return {
    character: [op03Thatch005, op03Izo003, twoThousandBaseAtFive, eb01Doma005],
    life: [op02Atmos003, op02Atmos003, op02Atmos003],
  };
}

describe("OP16-011 Vista", () => {
  test("ruling #969: the [On Play] reveal takes a hand Character at exactly 8000 power and draws 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [
          op16Vista011,
          op02Thatch007,
          op02DraculeMihawk055,
          op02Kingdew006,
          op10TrafalgarLaw119,
          eightThousandPowerLeader,
        ],
        deck: [eb01Doma005],
        activeDon: op16Vista011.cost,
      },
      {},
    );
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op02Thatch007),
      engine.findCardInZone("south", "hand", op02DraculeMihawk055),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op02Kingdew006);
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);
    const wrongCategoryId = engine.findCardInZone("south", "hand", eightThousandPowerLeader);

    engine.playCard(op16Vista011, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Vista's reveal payment.");
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

    expect(engine.getState().players.south.hand).toContain(
      engine.findCardInZone("south", "hand", eb01Doma005),
    );
    expect(engine.getView("south").players.south.deckCount).toBe(0);
  });

  test("[DON!! x1] [When Attacking] K.O.s up to 2 opponent Characters with 2000 BASE power or less", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Vista011, playedOnTurn: 0 }], activeDon: 1 },
      northBoard(),
      SOUTH_ATTACKS,
    );
    const vistaId = engine.findCardInZone("south", "character", op16Vista011);
    const firstTargetId = engine.findCardInZone("north", "character", op03Thatch005);
    const secondTargetId = engine.findCardInZone("north", "character", op03Izo003);
    const buffedId = engine.findCardInZone("north", "character", twoThousandBaseAtFive);
    const tooStrongId = engine.findCardInZone("north", "character", eb01Doma005);

    expect(
      engine
        .getView("south")
        .players.north.characters.find((entry) => entry?.instanceId === buffedId)?.power,
    ).toBe(5000);

    engine.attachDon(vistaId, 1, "south");
    engine.declareAttack(vistaId, engine.leader("north"), "south");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Vista's K.O. target choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [firstTargetId, secondTargetId, buffedId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooStrongId);

    // "up to 2" -- two at once, which an `amount: 1` encoding could not accept.
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [firstTargetId, buffedId] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[firstTargetId]?.zone).toBe("trash");
    expect(state.cards[buffedId]?.zone).toBe("trash");
    expect(state.cards[secondTargetId]?.zone).toBe("character");
    expect(state.cards[tooStrongId]?.zone).toBe("character");
  });

  test("[When Attacking] does nothing with no DON!! attached", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Vista011, playedOnTurn: 0 }], activeDon: 1 },
      northBoard(),
      SOUTH_ATTACKS,
    );
    const vistaId = engine.findCardInZone("south", "character", op16Vista011);
    const targetId = engine.findCardInZone("north", "character", op03Thatch005);

    engine.declareAttack(vistaId, engine.leader("north"), "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[targetId]?.zone).toBe("character");
  });
});
