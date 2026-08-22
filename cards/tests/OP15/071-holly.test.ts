import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import { op03Namule007, op05Ohm101, op15Holly071, op16PortgasDAce001 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #910 is the twin of #909 on OP15-070 Fuza; see that test for why a statically-named
// synthetic Leader stands in for a name-granting one, and why both name fields matter.
const ohmNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-071-LEADER-OHM",
  canonicalId: "TEST-OP15-071-LEADER-OHM",
  name: "Ohm",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Ohm" } },
};

registerCards([ohmNamedLeader]);

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// north's Leader is 5000 with 5 Life. Every attacker below is pitched at 5000 or more so the
// attack CONNECTS -- [Double Attack] has no projected field, so the only way to see it is that
// a connecting attack costs 2 Life instead of 1. south keeps 5 Life so op05Ohm101's own
// "2 or less Life" self-buff never switches on and cannot be confused for the grant.
function hollyBoard(leaderCardId: LeaderCard = op16PortgasDAce001) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [
        { card: op15Holly071, playedOnTurn: 0 },
        // op05Ohm101 is a pre-OP15 [Ohm] at 5000; op03Namule007 is the non-Ohm control at the
        // same power, which is what kills the "delete the name filter" mutant.
        { card: op05Ohm101, playedOnTurn: 0 },
        { card: op03Namule007, playedOnTurn: 0 },
      ],
      life: 5,
      activeDon: 2,
    },
    { leaderCardId: op16PortgasDAce001, life: 5 },
    SOUTH_ATTACKS,
  );
}

// The base-power clause is [Opponent's Turn], so it needs the mirror of SOUTH_ATTACKS.
//
// `southLife` is a parameter because op05Ohm101 carries "If you have 2 or less Life cards, this
// Character gains +1000 power" as a permanent effect of its own. At 5 Life that is off and Ohm is
// a plain 5000 body; at 2 Life it is a REAL power modifier live during the opponent's turn, which
// is what makes the stacking test below possible without inventing a synthetic card.
const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

function hollyBoardOnOpponentTurn(leaderCardId: LeaderCard = op16PortgasDAce001, southLife = 5) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [
        { card: op15Holly071, playedOnTurn: 0 },
        { card: op05Ohm101, playedOnTurn: 0 },
        { card: op03Namule007, playedOnTurn: 0 },
      ],
      life: southLife,
    },
    { leaderCardId: op16PortgasDAce001, life: 5 },
    NORTH_ATTACKS,
  );
}

function characterPower(engine: OnePieceTestEngine, card: CardRef) {
  const instanceId = engine.findCardInZone("south", "character", card);
  return engine.getView("south").players.south.characters.find((c) => c?.instanceId === instanceId)
    ?.power;
}

function leaderPower(engine: OnePieceTestEngine) {
  return engine.getView("south").players.south.leader.power;
}

function attackLeaderAndCountLifeLoss(engine: OnePieceTestEngine, attackerId: string) {
  const before = engine.getState().players.north.life.length;
  engine.declareAttack(attackerId, engine.leader("north"), "south");
  // A Life card that turns out to have a [Trigger] publishes a lifeTrigger confirm; skip any
  // that appear so the Life count settles before it is read.
  for (let guard = 0; guard < 4; guard += 1) {
    const pending = engine
      .getState()
      .promptQueue.find(
        (prompt) =>
          prompt.status === "pending" && prompt.resolutionContext?.intent === "lifeTrigger",
      );
    if (!pending) break;
    // "skip", not "no": an unrecognised optionId resolves as a silent skip and then derails a
    // later step instead of erroring here. The prompt belongs to the Life's owner, north --
    // `PromptState.seat` is `MatchSeat | "judge"` and does not narrow to `resolveDecision`'s
    // parameter type.
    engine.resolveDecision("lifeTrigger", { optionId: "skip" }, "north");
  }
  return before - engine.getState().players.north.life.length;
}

describe("OP15-071 Holly", () => {
  test("a non-[Ohm] Character of yours takes 1 Life -- the control", () => {
    const engine = hollyBoard();

    expect(
      attackLeaderAndCountLifeLoss(
        engine,
        engine.findCardInZone("south", "character", op03Namule007),
      ),
    ).toBe(1);
  });

  test("your [Ohm] gains [Double Attack] and takes 2 Life", () => {
    const engine = hollyBoard();

    expect(
      attackLeaderAndCountLifeLoss(engine, engine.findCardInZone("south", "character", op05Ohm101)),
    ).toBe(2);
  });

  test("this Character gains [Double Attack] too", () => {
    // "and this Character" is a second, self-targeted grant -- see OP15-070 Fuza for why the
    // two halves cannot share one permanent action.
    const engine = hollyBoard();
    const hollyId = engine.findCardInZone("south", "character", op15Holly071);
    // Holly is printed at 4000, under the 5000 Leader, so an unaided attack simply bounces off
    // and takes 0 Life whether or not she has the keyword. One attached DON!! (+1000 while its
    // controller is the active seat) puts her exactly on the line so the attack connects.
    engine.attachDon(hollyId, 1, "south");

    expect(attackLeaderAndCountLifeLoss(engine, hollyId)).toBe(2);
  });

  test("ruling #910: a Leader named [Ohm] gains [Double Attack] as well", () => {
    // What pins `zones: ["leader", "character"]`: dropping "leader" reads naturally and is wrong.
    const engine = hollyBoard(ohmNamedLeader);

    expect(attackLeaderAndCountLifeLoss(engine, engine.leader("south"))).toBe(2);
  });

  test("an ordinary Leader takes 1 Life", () => {
    const engine = hollyBoard();

    expect(attackLeaderAndCountLifeLoss(engine, engine.leader("south"))).toBe(1);
  });

  test("[Opponent's Turn] your [Ohm] and this Character both reach base power 6000", () => {
    // Ohm is 5000 printed and Holly 4000, so the two actions climb to the same literal from
    // different bases -- and `value: 6000 -> 5000` on the Ohm half would land Ohm exactly back on
    // its printed 5000, which is why the assertion has to be the exact number rather than "went up".
    const engine = hollyBoardOnOpponentTurn();

    expect(characterPower(engine, op05Ohm101)).toBe(6000);
    expect(characterPower(engine, op15Holly071)).toBe(6000);
  });

  test("[Opponent's Turn] a non-[Ohm] Character and an ordinary Leader are untouched", () => {
    // The name filter's negative control across both zones: delete it and Namule and the Leader,
    // both 5000, become 6000.
    const engine = hollyBoardOnOpponentTurn();

    expect(characterPower(engine, op03Namule007)).toBe(5000);
    expect(leaderPower(engine)).toBe(5000);
  });

  test("on YOUR own turn the base power clause is off", () => {
    const engine = hollyBoard();

    expect(characterPower(engine, op05Ohm101)).toBe(5000);
    expect(characterPower(engine, op15Holly071)).toBe(4000);
  });

  test("ruling #910: a Leader named [Ohm] reaches base power 6000 as well", () => {
    const engine = hollyBoardOnOpponentTurn(ohmNamedLeader);

    expect(leaderPower(engine)).toBe(6000);
  });

  test("a +power modifier STACKS on the new base rather than being absorbed by it", () => {
    // This is the whole reason the clause needs `setBasePower` and not `setPower`. At 2 Life
    // op05Ohm101's own permanent +1000 is live, so the printed reading is 6000 base + 1000 = 7000.
    // `setPower` sets TOTAL power -- it subtracts getCardPower at resolution -- and would clamp
    // this to 6000, which is also what the un-encoded card read. Neither number is reachable by
    // accident: on your own turn the same board reads 5000 + 1000 = 6000.
    const engine = hollyBoardOnOpponentTurn(op16PortgasDAce001, 2);
    expect(characterPower(engine, op05Ohm101)).toBe(7000);

    const ownTurn = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [
          { card: op15Holly071, playedOnTurn: 0 },
          { card: op05Ohm101, playedOnTurn: 0 },
        ],
        life: 2,
      },
      { leaderCardId: op16PortgasDAce001, life: 5 },
      SOUTH_ATTACKS,
    );
    expect(characterPower(ownTurn, op05Ohm101)).toBe(6000);
  });
});
