import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op03Namule007,
  op05JohnGiant044,
  op16Mr2BonKureiBentham055,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";
import { getEffectiveBasePower } from "../../../src/shared.ts";

const FILLER = [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003];

// The choice this card's encoding makes is `copyPower` (reads getCardPower, i.e. the source's
// CURRENT power) over `setBasePowerFrom` (reads basePower, the printed number). Distinguishing
// them needs an opponent Leader whose current power differs from its printed 5000 *during our
// turn*, and attached DON!! cannot do it: getCardPower only counts attached DON!! while its
// controller is the active seat, so a DON!! on their Leader is worth nothing on our turn. A
// permanent modifier is turn-agnostic and does the job.
const leaderBooster: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP16-055-LEADER-BOOSTER",
  canonicalId: "TEST-OP16-055-LEADER-BOOSTER",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            // `count: { amount: "all" }` is required: getPermanentModifierTotal skips any
            // permanent modifyPower whose target is neither `amount: "all"` nor `self: true`.
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: "all" } },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([leaderBooster]);

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("south")
    .players.south.characters.find((card) => card?.instanceId === instanceId)?.power;
}

describe("OP16-055 Mr.2.Bon.Kurei(Bentham)", () => {
  test("[On Play] draws 1 card", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Mr2BonKureiBentham055],
        deck: [op03Namule007, ...FILLER, ...FILLER],
        activeDon: 2,
      },
      {},
    );
    const topId = engine.findCardInZone("south", "deck", op03Namule007);

    engine.playCard(op16Mr2BonKureiBentham055, "south");

    expect(engine.getView("south").players.south.hand.map((card) => card.instanceId)).toEqual([
      topId,
    ]);
  });

  test("[DON!! x1] [When Attacking] copies the opponent Leader's CURRENT power, not its printed base power", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr2BonKureiBentham055, playedOnTurn: 0 }],
        hand: [],
        activeDon: 2,
      },
      {
        // A 10000-power rested body to swing into: nothing is K.O.'d, no Life moves, and the
        // `thisTurn` modifier stays readable off the projection afterwards.
        character: [{ card: op05JohnGiant044, playedOnTurn: 0, rested: true }, leaderBooster],
        hand: [],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const mr2Id = engine.findCardInZone("south", "character", op16Mr2BonKureiBentham055);
    const defenderId = engine.findCardInZone("north", "character", op05JohnGiant044);

    expect(engine.getView("north").players.north.leader.power).toBe(7000);

    engine.attachDon(mr2Id, 1, "south");
    // 1000 printed + 1000 from its own attached DON!!.
    expect(powerOf(engine, mr2Id)).toBe(2000);
    expect(getEffectiveBasePower(engine.getState(), mr2Id)).toBe(1000);

    engine.declareAttack(mr2Id, defenderId, "south");

    // Base power replaced by the Leader's CURRENT 7000, with Mr.2's own +1000 DON!! still
    // stacked on top. Under setBasePowerFrom this would read 6000 (5000 printed + 1000).
    // getEffectiveBasePower must be 7000 too: a type:"power" delta of +6000 would still
    // project 8000 while leaving the effective base at the printed 1000.
    expect(powerOf(engine, mr2Id)).toBe(8000);
    expect(getEffectiveBasePower(engine.getState(), mr2Id)).toBe(7000);

    engine.endTurn("south");
    // "during this turn" -- gone. On north's turn Mr.2's own attached DON!! is worth 0 as well,
    // so this is the bare printed 1000.
    expect(powerOf(engine, mr2Id)).toBe(1000);
    expect(getEffectiveBasePower(engine.getState(), mr2Id)).toBe(1000);
  });

  test("without an attached DON!! the [When Attacking] clause does nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr2BonKureiBentham055, playedOnTurn: 0 }],
        hand: [],
      },
      {
        character: [{ card: op05JohnGiant044, playedOnTurn: 0, rested: true }, leaderBooster],
        hand: [],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const mr2Id = engine.findCardInZone("south", "character", op16Mr2BonKureiBentham055);
    const defenderId = engine.findCardInZone("north", "character", op05JohnGiant044);

    engine.declareAttack(mr2Id, defenderId, "south");

    expect(powerOf(engine, mr2Id)).toBe(1000);
    expect(getEffectiveBasePower(engine.getState(), mr2Id)).toBe(1000);
  });
});
