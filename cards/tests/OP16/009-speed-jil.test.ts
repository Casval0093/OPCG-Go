import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op10TrafalgarLaw119,
  op16PortgasDAce001,
  op16SpeedJil009,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// A `trashFromHand` cost scans the whole hand with no card-type pre-filter, but the companion
// `power eq 8000` already excludes Events and Stages (basePower() zeroes both). A Leader is the
// only card that can carry 8000 power and still not be a Character, so this synthetic in hand is
// what makes `cardCategory: "character"` killable.
const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-009-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-009-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

registerCards([eightThousandPowerLeader]);

function fixture() {
  return {
    leaderCardId: op16PortgasDAce001,
    hand: [
      op16SpeedJil009,
      op02Thatch007,
      op02DraculeMihawk055,
      op02Kingdew006,
      op10TrafalgarLaw119,
      eightThousandPowerLeader,
    ],
    activeDon: op16SpeedJil009.cost,
  };
}

describe("OP16-009 Speed Jil", () => {
  test("ruling #967: the trash cost takes a hand Character at exactly 8000 power, granting [Rush] and exactly +2000", () => {
    const engine = OnePieceTestEngine.create(
      fixture(),
      { leaderCardId: op16PortgasDAce001, life: [op02Atmos003, op02Atmos003, op02Atmos003] },
      SOUTH_ATTACKS,
    );
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op02Thatch007),
      engine.findCardInZone("south", "hand", op02DraculeMihawk055),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op02Kingdew006);
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);
    const wrongCategoryId = engine.findCardInZone("south", "hand", eightThousandPowerLeader);

    engine.playCard(op16SpeedJil009, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Speed Jil's trash payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...exactPowerIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [exactPowerIds[0]!] },
      "south",
    );

    const speedJilId = engine.findCardInZone("south", "character", op16SpeedJil009);
    // 5000 printed + 2000. A `value: 1000` encoding would read 6000.
    expect(
      engine
        .getView("south")
        .players.south.characters.find((entry) => entry?.instanceId === speedJilId)?.power,
    ).toBe(7000);
    expect(engine.getState().cards[exactPowerIds[0]!]?.zone).toBe("trash");

    // [Rush] has no projected field: prove it by attacking on the turn it was played.
    engine.declareAttack(speedJilId, engine.leader("north"), "south");
    expect(engine.getView("north").players.north.lifeCount).toBe(2);
  });

  test("the grant lasts through the opponent's next End Phase, then expires", () => {
    const engine = OnePieceTestEngine.create(
      fixture(),
      { leaderCardId: op16PortgasDAce001 },
      SOUTH_ATTACKS,
    );
    const revealId = engine.findCardInZone("south", "hand", op02Thatch007);

    engine.playCard(op16SpeedJil009, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [revealId] }, "south");
    const speedJilId = engine.findCardInZone("south", "character", op16SpeedJil009);

    const power = () =>
      engine
        .getView("south")
        .players.south.characters.find((entry) => entry?.instanceId === speedJilId)?.power;

    expect(power()).toBe(7000);

    // Still live across the whole of the opponent's turn -- this is what separates
    // `untilEndOfOpponentNextEndPhase` from `thisTurn`.
    engine.endTurn("south");
    expect(power()).toBe(7000);

    engine.endTurn("north");
    expect(power()).toBe(5000);
  });

  test("declining the cost leaves Speed Jil at 5000 power and unable to attack the turn it is played", () => {
    const engine = OnePieceTestEngine.create(
      fixture(),
      { leaderCardId: op16PortgasDAce001 },
      SOUTH_ATTACKS,
    );

    engine.playCard(op16SpeedJil009, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");
    const speedJilId = engine.findCardInZone("south", "character", op16SpeedJil009);

    expect(
      engine
        .getView("south")
        .players.south.characters.find((entry) => entry?.instanceId === speedJilId)?.power,
    ).toBe(5000);
    expect(engine.getState().players.south.trash).toHaveLength(0);
    // The control for the [Rush] assertion above: without the grant this attack is illegal.
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: speedJilId,
        targetId: engine.leader("north"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
  });
});
