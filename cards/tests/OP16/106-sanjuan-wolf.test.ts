import { describe, expect, test } from "vite-plus/test";
import type { EventCard, Target } from "@tcg/op-types";
import {
  op01RadicalBeam029,
  op01Sai012,
  op02LittleoarsJr020,
  op05Ohm101,
  op09MarshallDTeach081,
  op12Issho082,
  op16CatarinaDevon104,
  op16SanjuanWolf106,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { candidatePoolForTarget } from "../../../src/effects/targeting.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A synthetic Event that K.O.s your OWN Sanjuan.Wolf. Needed because a Character cannot be K.O.'d
// by its own attack -- blocking redirects the attack, it never kills the attacker -- and the last
// two tests below need the [On K.O.] to fire on Sanjuan's OWN controller's turn so its `thisTurn`
// set base power is still live when the next thing happens. In real play that step is any opponent
// counter-step K.O., any opponent [On Your Opponent's Attack] K.O., or any own-effect K.O. cost.
// Only the K.O. source is synthetic; every card whose power is asserted is real.
const koYourSanjuan: EventCard = {
  ...op01RadicalBeam029,
  id: "TEST-OP16-106-KO-YOUR-SANJUAN",
  canonicalId: "TEST-OP16-106-KO-YOUR-SANJUAN",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "ko",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
              filters: [{ filter: "name", value: "Sanjuan.Wolf" }],
            },
          },
        ],
      },
    ],
  },
};

registerCards([koYourSanjuan]);

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// op02LittleoarsJr020 is a vanilla 9000 body, comfortably over Sanjuan.Wolf's 5000, so the battle
// K.O. is unconditional. op12Issho082 is a vanilla 10000 body on the defending side: it is there so
// the base-power clause can be watched moving a card DOWN, which no `modifyPower` could do and
// which is the clearest possible demonstration that the literal REPLACES the base.
// op09MarshallDTeach081 is the [Blackbeard Pirates] Leader at 5000; its own permanent effect
// negates [On Play] abilities and never touches power.
function sanjuanBoard(withBlackbeardLeader: boolean) {
  return OnePieceTestEngine.create(
    { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
    {
      ...(withBlackbeardLeader ? { leaderCardId: op09MarshallDTeach081 } : {}),
      character: [
        { card: op16SanjuanWolf106, rested: true },
        { card: op12Issho082, playedOnTurn: 0 },
      ],
    },
    SOUTH_ATTACKS,
  );
}

function northPower(engine: OnePieceTestEngine, instanceId: string) {
  const view = engine.getView("north").players.north;
  if (view.leader.instanceId === instanceId) return view.leader.power;
  return view.characters.find((card) => card?.instanceId === instanceId)?.power;
}

function koSanjuan(engine: OnePieceTestEngine) {
  engine.declareAttack(
    engine.findCardInZone("south", "character", op02LittleoarsJr020),
    engine.findCardInZone("north", "character", op16SanjuanWolf106),
    "south",
  );
}

describe("OP16-106 Sanjuan.Wolf", () => {
  test("[On K.O.] draws 1 and offers your Leader or Characters under a [Blackbeard Pirates] Leader", () => {
    const engine = sanjuanBoard(true);
    const sanjuanId = engine.findCardInZone("north", "character", op16SanjuanWolf106);
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    expect(engine.getView("north").players.north.hand).toHaveLength(0);

    koSanjuan(engine);

    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(1);

    // "your Leader or Character cards" is printed explicitly. Sanjuan.Wolf itself is in the trash
    // by now, so the offer is the Leader and Issho and nothing else.
    const target = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (target?.kind !== "selectEntity") throw new Error("Expected the base-power recipient.");
    expect(target.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), isshoId].sort(),
    );
  });

  test("[On K.O.] raises a chosen Leader from 5000 to exactly 7000", () => {
    const engine = sanjuanBoard(true);
    const leaderId = engine.leader("north");

    koSanjuan(engine);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [leaderId] }, "north");

    // The exact number kills `value: 7000 -> 6000`, which on a 5000 Leader would read as a
    // perfectly plausible +1000.
    expect(northPower(engine, leaderId)).toBe(7000);
  });

  test("[On K.O.] LOWERS a chosen 10000 Character to exactly 7000", () => {
    // This is the assertion that no additive encoding can pass at any value: the same clause that
    // raised a 5000 Leader to 7000 has to pull a 10000 body DOWN to 7000. It is also what separates
    // `setBasePower` from `modifyPower` beyond doubt.
    const engine = sanjuanBoard(true);
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    koSanjuan(engine);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [isshoId] }, "north");

    expect(northPower(engine, isshoId)).toBe(7000);
  });

  // OP16-013 McGuy's K.O. target, copied verbatim: "K.O. up to 1 of your opponent's Characters
  // with 8000 base power or less."
  const KO_BASE_POWER_LTE_8000 = {
    player: "opponent",
    zones: ["character"],
    count: { amount: 1, upTo: true },
    filters: [{ filter: "basePower", comparison: "lte", value: 8000 }],
  } as const satisfies Target;

  // Evaluated as SOUTH, so `player: "opponent"` resolves to north's character area -- the side
  // sanjuanBoard puts Sanjuan.Wolf and Issho on.
  function koCandidates(engine: OnePieceTestEngine) {
    const pool = candidatePoolForTarget(engine.getState(), "south", null, KO_BASE_POWER_LTE_8000);
    expect(pool.supported).toBe(true);
    return pool.candidateIds;
  }

  test("ruling #762: lowering a 10000 body to base 7000 makes it a legal `lte 8000` K.O. target", () => {
    // The other direction from OP15-070 Fuza's test, on the other code path. Fuza is a PERMANENT
    // effect lifting a body OUT of a K.O. pool; this is a TIMED modifier pulling one IN, and both
    // have to be visible to a base-power filter for ruling #762 to hold.
    //
    // The pool is asserted WHOLE at both ends. Before the clause resolves it is Sanjuan.Wolf
    // itself (5000, already under the threshold) and NOT Issho (10000); after, Sanjuan.Wolf is in
    // the trash and Issho is the only member. So neither end is satisfied by an empty pool.
    const engine = sanjuanBoard(true);
    const sanjuanId = engine.findCardInZone("north", "character", op16SanjuanWolf106);
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    expect(koCandidates(engine)).toEqual([sanjuanId]);

    koSanjuan(engine);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [isshoId] }, "north");

    expect(northPower(engine, isshoId)).toBe(7000);
    expect(koCandidates(engine)).toEqual([isshoId]);
  });

  test("[On K.O.] 'up to 1' may be declined, and then nothing moves", () => {
    const engine = sanjuanBoard(true);
    const leaderId = engine.leader("north");
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    koSanjuan(engine);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "north");

    expect(northPower(engine, leaderId)).toBe(5000);
    expect(northPower(engine, isshoId)).toBe(10000);
  });

  test("[On K.O.] does nothing at all without a [Blackbeard Pirates] Leader", () => {
    // The Leader gate leads the sentence, so it gates BOTH halves: no draw and no offer, rather
    // than an offer with nothing drawn.
    const engine = sanjuanBoard(false);
    const sanjuanId = engine.findCardInZone("north", "character", op16SanjuanWolf106);
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    koSanjuan(engine);

    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(0);
    expect(() => engine.pendingDecision("effectTargetSelection", "north")).toThrow();
    expect(northPower(engine, isshoId)).toBe(10000);
  });

  test("a +power modifier STACKS on the new base -- this is not `setPower` in disguise", () => {
    // Without this the encoding is indistinguishable from `setPower`, the verb the card's own
    // PARKED note existed to reject: on a target carrying no modifier both verbs land on 7000, so
    // swapping them keeps every other test in this file green. op05Ohm101 is printed 5000 and
    // carries its own permanent "2 or less Life cards: +1000 power", so at 2 Life it is a 6000 body
    // whose extra 1000 is a real power modifier. setBasePower -> 7000 + 1000 = 8000;
    // setPower -> `7000 - 6000` = +1000 on top of 6000 = 7000.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        character: [
          { card: op16SanjuanWolf106, rested: true },
          { card: op05Ohm101, playedOnTurn: 0 },
        ],
        life: 2,
      },
      SOUTH_ATTACKS,
    );
    const ohmId = engine.findCardInZone("north", "character", op05Ohm101);
    expect(northPower(engine, ohmId)).toBe(6000);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02LittleoarsJr020),
      engine.findCardInZone("north", "character", op16SanjuanWolf106),
      "south",
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [ohmId] }, "north");

    expect(northPower(engine, ohmId)).toBe(8000);
  });

  test("the set base power is gone after the turn ends -- `duration: thisTurn` is real", () => {
    // Nothing else in this batch crosses a turn boundary, so without this the duration field is
    // unfalsifiable: `permanent` would pass every other assertion.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        character: [
          { card: op16SanjuanWolf106, rested: true },
          { card: op12Issho082, playedOnTurn: 0 },
        ],
      },
      SOUTH_ATTACKS,
    );
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02LittleoarsJr020),
      engine.findCardInZone("north", "character", op16SanjuanWolf106),
      "south",
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [isshoId] }, "north");
    expect(northPower(engine, isshoId)).toBe(7000);

    engine.endTurn("south");
    expect(northPower(engine, isshoId)).toBe(10000);
  });

  test("copyPower REPLACES this clause's set base power instead of stacking on it", () => {
    // REGRESSION GUARD. `copyPower`, `setBasePowerFrom` and `swapBasePower` each add a
    // `type: "power"` delta of `desired - <base>`. While getCardPower started from the PRINTED
    // base that was self-consistent: printed + (desired - printed) == desired. Once it starts from
    // getEffectiveBasePower, a card carrying BOTH a literal and one of those deltas reads
    // `literal + (desired - printed)` -- two mutually exclusive REPLACEMENTS added together.
    //
    // Devon is printed 3000, set to 7000 by this card, then copies a 10000 body:
    //   correct                     10000
    //   printed-base delta   7000 + (10000 - 3000) = 14000   <- what the engine returned before
    // Both cards are real, yellow and legal together.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        hand: [koYourSanjuan],
        character: [
          { card: op16SanjuanWolf106, playedOnTurn: 0 },
          { card: op16CatarinaDevon104, playedOnTurn: 0 },
        ],
        activeDon: 3,
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const devonId = engine.findCardInZone("north", "character", op16CatarinaDevon104);
    const isshoId = engine.findCardInZone("south", "character", op12Issho082);

    expect(northPower(engine, devonId)).toBe(3000);

    engine.playCard(koYourSanjuan, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [devonId] }, "north");
    expect(northPower(engine, devonId)).toBe(7000);

    engine.declareAttack(devonId, engine.leader("south"), "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [isshoId] }, "north");

    expect(northPower(engine, devonId)).toBe(10000);
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        life: [op16SanjuanWolf106, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const sanjuanId = engine.findCardInZone("north", "life", op16SanjuanWolf106);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // The base-power half now has to be resolved before the [Trigger]'s own resolution completes --
    // the Leader is the only candidate here, and it is the attacked card, so raising it is real.
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
    expect(northPower(engine, engine.leader("north"))).toBe(7000);
  });
});
