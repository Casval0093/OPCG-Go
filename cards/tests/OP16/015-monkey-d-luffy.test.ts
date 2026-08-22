import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, EventCard } from "@tcg/op-types";
import {
  op01RadicalBeam029,
  op02Franky039,
  op02LittleoarsJr020,
  op02Thatch007,
  op04Kuro023,
  op12Issho082,
  op16MonkeyDLuffy015,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";
import { getCardPower } from "../../../src/shared.ts";

// Only the [On Your Opponent's Attack] clause is encoded; the cost-reduction clause is parked on
// `nameIncludesMatch` (see the PARKED note on the card).
//
// The cost's `{ filter: "cardCategory", value: "character" }` needs a non-Character with 8000 power
// to have any observable effect, and no printed card can be one: basePower() (shared.ts) returns 0
// for anything that is not a Leader or a Character, and Leaders never sit in hand. So the control
// has to be synthetic -- an Event that buffs ITSELF by 8000 while in hand. That works because
// getPermanentModifierTotal makes an explicit exception for a source that is its own target in hand
// (`sourceIsSelfInHand`), which is the mechanism every "give this card in your hand -N cost" uses.
// Without this card the cardCategory filter is an unfalsifiable decoration.
const eightThousandPowerEvent: EventCard = {
  ...op01RadicalBeam029,
  id: "TEST-OP16-015-EVENT-8000-POWER",
  canonicalId: "TEST-OP16-015-EVENT-8000-POWER",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["hand"], count: { amount: 1 }, self: true },
            value: 8000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

// A synthetic body that permanently gives YOUR LEADER +1000. Needed because without a live power
// modifier on a target, `setBasePower` and `setPower` land on the same number here (7000), so the
// verb this card's clause needs would be swappable with the one its sibling cards' PARKED notes
// exist to reject, and every test in this file would stay green. A permanent modifyPower over a
// zone other than the source's own must be written `count.amount: "all"` or
// getPermanentModifierTotal drops it silently (cards/ENCODING.md).
const leaderBuff: CharacterCard = {
  ...op02Franky039,
  id: "TEST-OP16-015-LEADER-BUFF",
  canonicalId: "TEST-OP16-015-LEADER-BUFF",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: "all" } },
            value: 1000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([eightThousandPowerEvent, leaderBuff]);

// The trigger is [On Your Opponent's Attack], so it is north's turn and south is the defender. That
// also means south's own DON!! contributes nothing to power here (getCardPower only counts attached
// DON!! for the ACTIVE seat), so every number below is base plus this clause and nothing else.
//
// Printed powers, all deliberately distinct from 7000: the Leader 5000, this Luffy 6000,
// Thatch and Kuro 8000, Franky 7000 in hand only, Littleoars Jr. 9000, Issho 10000.
const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

function luffyDefends(hand: CardRef[]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [{ card: op16MonkeyDLuffy015, playedOnTurn: 0 }],
      hand,
    },
    {
      leaderCardId: op16PortgasDAce001,
      character: [{ card: op12Issho082, playedOnTurn: 0 }],
    },
    NORTH_ATTACKS,
  );
}

function attackTheLeader(engine: OnePieceTestEngine) {
  engine.declareAttack(
    engine.findCardInZone("north", "character", op12Issho082),
    engine.leader("south"),
    "north",
  );
}

function southPowers(engine: OnePieceTestEngine) {
  const view = engine.getView("south").players.south;
  const luffyId = engine.findCardInZone("south", "character", op16MonkeyDLuffy015);
  return {
    leader: view.leader.power,
    luffy: view.characters.find((card) => card?.instanceId === luffyId)?.power,
  };
}

describe("OP16-015 Monkey.D.Luffy", () => {
  test("the cost offers ONLY Character cards with exactly 8000 power", () => {
    // One assertion, four mutants. With five cards in hand and two legal payments the engine opens
    // a cost prompt (it auto-pays only when candidates <= amount), so the eligible list is directly
    // readable:
    //   delete filter:power        -> all five are offered
    //   delete filter:cardCategory -> the synthetic 8000-power Event joins them
    //   comparison eq -> gte       -> Littleoars Jr. at 9000 joins them
    //   value 8000 -> 7000         -> only Franky qualifies, so there is ONE candidate and the
    //                                 prompt never opens at all
    const engine = luffyDefends([
      op02Thatch007,
      op04Kuro023,
      op02Franky039,
      op02LittleoarsJr020,
      eightThousandPowerEvent,
    ]);
    const thatchId = engine.findCardInZone("south", "hand", op02Thatch007);
    const kuroId = engine.findCardInZone("south", "hand", op04Kuro023);

    attackTheLeader(engine);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected the trash-from-hand cost prompt.");
    expect(payment).toMatchObject({ min: 1, max: 1 });
    expect(payment.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [thatchId, kuroId].sort(),
    );
  });

  test("paying it takes your Leader AND this Character to exactly 7000", () => {
    // With a single legal payment the cost auto-pays, so this exercises the whole ability in one
    // step. 5000 -> 7000 on the Leader and 6000 -> 7000 on Luffy: two different printed bases
    // landing on one literal, which is what no single `modifyPower` value can do. The exact numbers
    // kill `value: 7000 -> 6000` on each action independently -- and on Luffy that mutant would
    // read as her own printed 6000, i.e. as nothing having happened.
    const engine = luffyDefends([op02Thatch007]);
    const thatchId = engine.findCardInZone("south", "hand", op02Thatch007);

    expect(southPowers(engine)).toEqual({ leader: 5000, luffy: 6000 });

    attackTheLeader(engine);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(southPowers(engine)).toEqual({ leader: 7000, luffy: 7000 });
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      thatchId,
    );
  });

  test("a +power modifier STACKS on the new base -- this is not `setPower` in disguise", () => {
    // The Leader is 5000 printed and 6000 with the synthetic buff live. setBasePower substitutes
    // the base and keeps the modifier: 7000 + 1000 = 8000. `setPower` would compute
    // `7000 - 6000` = +1000 on top of 6000 and land on 7000 -- the same number every other test in
    // this file asserts, which is why they cannot tell the two verbs apart on their own.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [
          { card: op16MonkeyDLuffy015, playedOnTurn: 0 },
          { card: leaderBuff, playedOnTurn: 0 },
        ],
        hand: [op02Thatch007],
      },
      {
        leaderCardId: op16PortgasDAce001,
        character: [{ card: op12Issho082, playedOnTurn: 0 }],
      },
      NORTH_ATTACKS,
    );
    expect(engine.getView("south").players.south.leader.power).toBe(6000);

    attackTheLeader(engine);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").players.south.leader.power).toBe(8000);
  });

  test("'You may' means it can be declined, and then nothing moves", () => {
    const engine = luffyDefends([op02Thatch007]);
    const thatchId = engine.findCardInZone("south", "hand", op02Thatch007);

    attackTheLeader(engine);
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(southPowers(engine)).toEqual({ leader: 5000, luffy: 6000 });
    expect(engine.getView("south").players.south.hand.map((card) => card.instanceId)).toContain(
      thatchId,
    );
  });

  test("ruling #972: a 7000-power Character cannot pay, so the ability is never offered", () => {
    // 不, 是指力量刚好为8000的角色卡牌. An optional block whose cost cannot be paid does not even
    // open its confirm prompt (canPayCosts gates it in effects/resolution.ts), so "not offered" is
    // the observable form of "does not qualify".
    const engine = luffyDefends([op02Franky039]);

    attackTheLeader(engine);

    expect(() => engine.pendingDecision("effectOptional", "south")).toThrow();
    expect(southPowers(engine)).toEqual({ leader: 5000, luffy: 6000 });
  });

  test("ruling #972: a 9000-power Character cannot pay either", () => {
    // The other side of the 8000 boundary, and the only thing that separates `eq` from `gte` when
    // the hand holds a single card.
    const engine = luffyDefends([op02LittleoarsJr020]);

    attackTheLeader(engine);

    expect(() => engine.pendingDecision("effectOptional", "south")).toThrow();
    expect(southPowers(engine)).toEqual({ leader: 5000, luffy: 6000 });
  });

  test("a non-Character card reading 8000 power cannot pay", () => {
    // The cardCategory filter's own control. Under `delete filter:cardCategory` this Event is a
    // legal payment and the ability fires.
    const engine = luffyDefends([eightThousandPowerEvent]);
    const eventId = engine.findCardInZone("south", "hand", eightThousandPowerEvent);

    // Non-vacuity, and it is not optional: the projection reports `power: null` for an Event
    // whatever its modifiers, so nothing in a view assertion would notice this card reading 0. If
    // it did read 0 then BOTH this test and the eligible-list test above would pass while proving
    // nothing about the cardCategory filter at all.
    expect(getCardPower(engine.getState(), eventId)).toBe(8000);

    attackTheLeader(engine);

    expect(() => engine.pendingDecision("effectOptional", "south")).toThrow();
    expect(southPowers(engine)).toEqual({ leader: 5000, luffy: 6000 });
  });
});
