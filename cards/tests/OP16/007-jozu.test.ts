import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op03Namule007,
  op10TrafalgarLaw119,
  op16Jozu007,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// Only a Leader can carry power outside the character/leader split that `basePower()` respects,
// so a Leader planted in the hand fixture is the one thing that exercises `cardCategory`.
const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-007-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-007-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

registerCards([eightThousandPowerLeader]);

describe("OP16-007 Jozu", () => {
  test("ruling #965: only hand Characters at exactly 8000 power pay the reveal, and the target loses exactly 1000 power", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [
          op16Jozu007,
          // Two exactly-8000 Characters: a cost with a single eligible candidate auto-pays
          // without publishing a prompt, and then nothing about the filter is observable.
          op02Thatch007,
          op02DraculeMihawk055,
          op02Kingdew006,
          op10TrafalgarLaw119,
          eightThousandPowerLeader,
        ],
        activeDon: op16Jozu007.cost,
      },
      // 3000 power: after -1000 it reads 2000 exactly. A -2000 encoding would read 1000, and
      // `mutation_check.py` generates no mutant for a negative magnitude.
      { character: [eb01Doma005, op03Namule007] },
    );
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op02Thatch007),
      engine.findCardInZone("south", "hand", op02DraculeMihawk055),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op02Kingdew006);
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);
    const wrongCategoryId = engine.findCardInZone("south", "hand", eightThousandPowerLeader);
    const victimId = engine.findCardInZone("north", "character", eb01Doma005);
    const bystanderId = engine.findCardInZone("north", "character", op03Namule007);

    engine.playCard(op16Jozu007, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Jozu's reveal payment.");
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

    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");

    const characters = engine.getView("south").players.north.characters;
    expect(characters.find((entry) => entry?.instanceId === victimId)?.power).toBe(2000);
    // "up to 1": only the chosen Character is touched.
    expect(characters.find((entry) => entry?.instanceId === bystanderId)?.power).toBe(5000);
  });

  test("the -1000 lasts only this turn", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Jozu007, op02Thatch007, op02DraculeMihawk055],
        activeDon: op16Jozu007.cost,
      },
      { character: [eb01Doma005] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const revealId = engine.findCardInZone("south", "hand", op02Thatch007);
    const victimId = engine.findCardInZone("north", "character", eb01Doma005);

    engine.playCard(op16Jozu007, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectCostRevealFromHand", { selectedIds: [revealId] }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");

    expect(
      engine
        .getView("south")
        .players.north.characters.find((entry) => entry?.instanceId === victimId)?.power,
    ).toBe(2000);

    engine.endTurn("south");

    expect(
      engine
        .getView("south")
        .players.north.characters.find((entry) => entry?.instanceId === victimId)?.power,
    ).toBe(3000);
  });

  test("[Blocker] offers this Character as a block target on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { character: [op16Jozu007] },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ATTACKS,
    );
    const jozuId = engine.findCardInZone("south", "character", op16Jozu007);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    const block = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (block?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(block.candidates.map((candidate) => candidate.ref.id)).toContain(jozuId);
  });
});
