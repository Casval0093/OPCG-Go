import { describe, expect, test } from "vite-plus/test";
import type { Target } from "@tcg/op-types";
import {
  op02Atmos003,
  op02EdwardNewgate001,
  op02Kingdew006,
  op03Namule007,
  op16Mr2BonKureiBentham036,
} from "@tcg/op-cards";

import { candidatePoolForTarget } from "../../../src/effects/targeting.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";
import { getEffectiveBasePower } from "../../../src/shared.ts";

function benthamPower(engine: OnePieceTestEngine, instanceId: string): number {
  const card = engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === instanceId);
  if (!card || card.power === null) throw new Error("Bentham is not on the field.");
  return card.power;
}

const BASE_POWER_GTE_6000 = {
  player: "self",
  zones: ["character"],
  count: { amount: "all" },
  filters: [{ filter: "basePower", comparison: "gte", value: 6000 }],
} as const satisfies Target;

function gte6000(engine: OnePieceTestEngine) {
  const pool = candidatePoolForTarget(engine.getState(), "south", null, BASE_POWER_GTE_6000);
  expect(pool.supported).toBe(true);
  return pool.candidateIds;
}

describe("OP16-036 Mr.2.Bon.Kurei(Bentham)", () => {
  test("[On Play] rests an opponent Character of cost exactly 4 or below, never a cost-5 one", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16Mr2BonKureiBentham036], activeDon: op16Mr2BonKureiBentham036.cost },
      { character: [op03Namule007, op02Atmos003, op02Kingdew006] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const cheapId = engine.findCardInZone("north", "character", op03Namule007); // cost 3
    const onTheLineId = engine.findCardInZone("north", "character", op02Atmos003); // cost 4
    const overTheLineId = engine.findCardInZone("north", "character", op02Kingdew006); // cost 5

    engine.playCard(op16Mr2BonKureiBentham036, "south");

    const target = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(target).toMatchObject({ kind: "selectEntity", min: 0, max: 1 });
    if (target?.kind !== "selectEntity") throw new Error("Expected Bentham's rest choice.");
    // A body exactly on the line proves the number; the cost-3 body is what a `gte` reading
    // would wrongly drop; the cost-5 body is what deleting the filter would wrongly add.
    expect(target.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [cheapId, onTheLineId].sort(),
    );
    expect(target.candidates.map((candidate) => candidate.ref.id)).not.toContain(overTheLineId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [onTheLineId] }, "south");

    expect(engine.getState().cards[onTheLineId]?.rested).toBe(true);
    expect(engine.getState().cards[cheapId]?.rested).toBe(false);
  });

  test("[When Attacking] copies the OPPONENT's Leader's base power for the turn, then gives it back", () => {
    // op02EdwardNewgate001 prints 6000 power; south's default Leader prints 5000. Every real
    // Leader but four prints 5000, so a mismatched pair is the only way to tell "your
    // opponent's Leader" from "your Leader" -- copying the wrong one would read 5000 here.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Mr2BonKureiBentham036, playedOnTurn: 0 }] },
      {
        leaderCardId: op02EdwardNewgate001,
        life: [op03Namule007, op03Namule007, op03Namule007, op03Namule007, op03Namule007],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const benthamId = engine.findCardInZone("south", "character", op16Mr2BonKureiBentham036);

    expect(benthamPower(engine, benthamId)).toBe(1000);
    expect(getEffectiveBasePower(engine.getState(), benthamId)).toBe(1000);

    engine.declareAttack(benthamId, engine.leader("north"), "south");

    // A `thisTurn` modifier is readable straight off the projection (unlike `thisBattle`),
    // so the magnitude is asserted as an exact number. getEffectiveBasePower must move too:
    // a type:"power" delta of +5000 would still read 6000 on the projection while leaving
    // the effective base at the printed 1000, which is the defect ruling #762 forbids.
    expect(benthamPower(engine, benthamId)).toBe(6000);
    expect(getEffectiveBasePower(engine.getState(), benthamId)).toBe(6000);

    engine.endTurn("south");
    expect(benthamPower(engine, benthamId)).toBe(1000);
    expect(getEffectiveBasePower(engine.getState(), benthamId)).toBe(1000);
  });

  test("ruling #762: a timed setBasePowerFrom is visible to a basePower gte 6000 pool", () => {
    // The Standard-legal twin of OP06-009 Shuraiya. Carina's question (EB03-004, ruling #762)
    // is whether a body whose 原本的力量 *became* 6000 by effect counts as a 6000-or-more
    // base-power Character. Until the patch NAMED
    // `actions: timed setBasePowerFrom/copyPower/swapBasePower store a setBasePower replacement`,
    // this verb wrote a `type: "power"` delta, so getEffectiveBasePower stayed at the printed
    // 1000 and the pool -- routed through getEffectiveBasePower by
    // `targeting: ruling #762, the basePower filter reads the EFFECTIVE base` -- never saw it.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Mr2BonKureiBentham036, playedOnTurn: 0 }], activeDon: 5 },
      {
        leaderCardId: op02EdwardNewgate001,
        life: [op03Namule007, op03Namule007, op03Namule007, op03Namule007, op03Namule007],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const benthamId = engine.findCardInZone("south", "character", op16Mr2BonKureiBentham036);

    engine.attachDon(benthamId, 5, "south");
    // 1000 printed + 5000 DON!! = 6000 current, still 1000 base. A filter that wrongly read
    // getCardPower would admit this body before the clause fires.
    expect(benthamPower(engine, benthamId)).toBe(6000);
    expect(getEffectiveBasePower(engine.getState(), benthamId)).toBe(1000);
    expect(gte6000(engine)).toEqual([]);

    engine.declareAttack(benthamId, engine.leader("north"), "south");

    expect(getEffectiveBasePower(engine.getState(), benthamId)).toBe(6000);
    expect(benthamPower(engine, benthamId)).toBe(11000);
    expect(gte6000(engine)).toEqual([benthamId]);
  });
});
