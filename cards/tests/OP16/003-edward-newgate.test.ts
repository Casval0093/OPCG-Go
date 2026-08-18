import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op03Namule007,
  op04Kuro023,
  op10TrafalgarLaw119,
  op16EdwardNewgate003,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// basePower() (shared.ts) hard-zeroes Events and Stages, so neither can ever satisfy
// "power eq 8000" no matter what filters are present -- a Leader is the ONLY card type that
// can. This synthetic 8000-power Leader, placed straight into the hand fixture (something that
// never happens in real play), is therefore the only thing that makes the `cardCategory:
// "character"` filter killable.
const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-003-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-003-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

registerCards([eightThousandPowerLeader]);

describe("OP16-003 Edward.Newgate", () => {
  test("ruling #963: only hand Characters at exactly 8000 power pay the 2-card reveal, and the target loses exactly 6000 power", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [
          op16EdwardNewgate003,
          // Three exactly-8000 Characters: the cost reveals 2, and the engine only publishes a
          // selection prompt when candidates outnumber the amount, so a third is what makes the
          // excluded candidates assertable at all.
          op02Thatch007,
          op02DraculeMihawk055,
          op04Kuro023,
          // 7000 -- excluded by `eq`; would qualify under a `gte` reading or a 7000 threshold.
          op02Kingdew006,
          // 9000 -- excluded by `eq`; would qualify under `gte`.
          op10TrafalgarLaw119,
          eightThousandPowerLeader,
        ],
        // A body of my own, to show the -6000 is scoped to the opponent's Characters.
        character: [op03Namule007],
        activeDon: op16EdwardNewgate003.cost,
      },
      {
        // Exactly 6000 power: -6000 lands it on 0 and it stays on the field (GENERAL ruling #4).
        // The magnitude is a negative number, which `mutation_check.py` never perturbs, so the
        // exact resulting power is asserted by hand below.
        character: [op02Atmos003],
      },
      SOUTH_ATTACKS,
    );
    const exactPowerIds = [
      engine.findCardInZone("south", "hand", op02Thatch007),
      engine.findCardInZone("south", "hand", op02DraculeMihawk055),
      engine.findCardInZone("south", "hand", op04Kuro023),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op02Kingdew006);
    const overPowerId = engine.findCardInZone("south", "hand", op10TrafalgarLaw119);
    const wrongCategoryId = engine.findCardInZone("south", "hand", eightThousandPowerLeader);
    const ownCharacterId = engine.findCardInZone("south", "character", op03Namule007);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op16EdwardNewgate003, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Edward.Newgate's 2-card reveal.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...exactPowerIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);
    engine.resolveDecision(
      "effectCostRevealFromHand",
      { selectedIds: [exactPowerIds[0]!, exactPowerIds[1]!] },
      "south",
    );

    const debuff = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (debuff?.kind !== "selectEntity") throw new Error("Expected the -6000 power target.");
    expect(debuff.candidates.map((candidate) => candidate.ref.id)).toEqual([victimId]);
    expect(debuff.candidates.map((candidate) => candidate.ref.id)).not.toContain(ownCharacterId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");

    // 6000 - 6000 = 0 exactly, read off the projection while the `thisTurn` modifier is live.
    // A -5000 encoding would leave 1000 here and every other assertion in this test would pass.
    const view = engine.getView("south");
    const victim = view.players.north.characters.find(
      (character) => character?.instanceId === victimId,
    );
    expect(victim?.power).toBe(0);
    // GENERAL ruling #4: a Character at 0 power or less stays on the field.
    expect(engine.getState().cards[victimId]?.zone).toBe("character");
    // The revealed cards are still in hand -- a reveal is not a discard.
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(exactPowerIds[0]);
  });

  test("[Your Turn] gives the Leader exactly +2000 and [Double Attack], and both lapse on the opponent's turn", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16EdwardNewgate003],
        activeDon: op16EdwardNewgate003.cost,
      },
      { leaderCardId: op16PortgasDAce001, life: [op02Atmos003, op02Atmos003, op02Atmos003] },
      SOUTH_ATTACKS,
    );

    expect(engine.getView("south").players.south.leader.power).toBe(5000);

    engine.playCard(op16EdwardNewgate003, "south");
    // No [On Play] prompt at all: the hand is now empty, so the 2-card reveal cost is unpayable
    // and the engine never offers the optional block.
    expect(engine.getView("south").prompts).toHaveLength(0);

    // 5000 base + 2000. A `value: 1000` encoding would read 6000 here.
    expect(engine.getView("south").players.south.leader.power).toBe(7000);

    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");

    // 7000 vs a 5000 Leader connects, and [Double Attack] takes 2 Life rather than 1.
    expect(engine.getView("north").players.north.lifeCount).toBe(1);

    engine.endTurn("south");

    // [Your Turn] only: on the opponent's turn the Leader is back to its printed power.
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("without Edward.Newgate the same Leader attack is 5000 power and takes 1 Life", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op16PortgasDAce001, activeDon: 8 },
      { leaderCardId: op16PortgasDAce001, life: [op02Atmos003, op02Atmos003, op02Atmos003] },
      SOUTH_ATTACKS,
    );

    expect(engine.getView("south").players.south.leader.power).toBe(5000);
    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(2);
  });
});
