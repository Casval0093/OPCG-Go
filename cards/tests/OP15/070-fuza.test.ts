import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op03Namule007,
  op04Ideo077,
  op05Shura106,
  op15Fuza070,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #909 asks whether a Leader that has every card's name picks up this grant. 是的. There
// is no `grantName` action in the engine, but a Leader whose STATIC name is "Shura" is
// indistinguishable from a granted one to the `name` TargetFilter -- which resolves through
// `cardName()`, i.e. `i18n.en.name`, so BOTH name fields have to be overridden.
const shuraNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-070-LEADER-SHURA",
  canonicalId: "TEST-OP15-070-LEADER-SHURA",
  name: "Shura",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Shura" } },
};

registerCards([shuraNamedLeader]);

// south is second, so it may attack on its own first turn. north's blocker is left ACTIVE --
// a rested one could not block, and "no blocker prompt" would then mean nothing.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function fuzaBoard(leaderCardId: LeaderCard = op16PortgasDAce001) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [
        { card: op15Fuza070, playedOnTurn: 0 },
        // op05Shura106 is a pre-OP15 [Shura]; op03Namule007 is the non-Shura control that must
        // stay blockable, which is what kills the "delete the name filter" mutant.
        { card: op05Shura106, playedOnTurn: 0 },
        { card: op03Namule007, playedOnTurn: 0 },
      ],
      activeDon: 2,
    },
    { leaderCardId: op16PortgasDAce001, character: [op04Ideo077] },
    SOUTH_ATTACKS,
  );
}

// The base-power clause is [Opponent's Turn], so it needs the mirror of SOUTH_ATTACKS. Everything
// on this board is deliberately at a DIFFERENT printed power from 6000 -- Shura 2000, Fuza 4000,
// Namule 5000, the Leader 5000 -- so "became 6000" can never be confused with "was already 6000".
const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

function fuzaBoardOnOpponentTurn(leaderCardId: LeaderCard = op16PortgasDAce001) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [
        { card: op15Fuza070, playedOnTurn: 0 },
        { card: op05Shura106, playedOnTurn: 0 },
        { card: op03Namule007, playedOnTurn: 0 },
      ],
    },
    { leaderCardId: op16PortgasDAce001, character: [op04Ideo077] },
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

function blockerPromptPending(engine: OnePieceTestEngine) {
  return engine
    .getState()
    .promptQueue.some(
      (prompt) =>
        prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
    );
}

describe("OP15-070 Fuza", () => {
  test("a non-[Shura] Character of yours IS blockable -- the control", () => {
    // Without this, "the blocker step never opened" below could just as well mean the fixture
    // never had a legal blocker.
    const engine = fuzaBoard();

    engine.declareAttack(
      engine.findCardInZone("south", "character", op03Namule007),
      engine.leader("north"),
      "south",
    );
    expect(blockerPromptPending(engine)).toBe(true);
  });

  test("your [Shura] gains [Unblockable]", () => {
    const engine = fuzaBoard();

    engine.declareAttack(
      engine.findCardInZone("south", "character", op05Shura106),
      engine.leader("north"),
      "south",
    );
    expect(blockerPromptPending(engine)).toBe(false);
  });

  test("this Character gains [Unblockable] too", () => {
    // "and this Character" is a second, self-targeted grant: a permanent grantKeyword whose
    // target is neither `self: true` nor `count.amount: "all"` is skipped outright
    // (permanentKeywordsFor, effects/permanent.ts), so the two halves cannot share one action.
    const engine = fuzaBoard();

    engine.declareAttack(
      engine.findCardInZone("south", "character", op15Fuza070),
      engine.leader("north"),
      "south",
    );
    expect(blockerPromptPending(engine)).toBe(false);
  });

  test("ruling #909: a Leader named [Shura] gains [Unblockable] as well", () => {
    // This is what pins `zones: ["leader", "character"]`. Dropping "leader" reads perfectly
    // naturally -- "all of your [Shura] cards" -- and is wrong.
    const engine = fuzaBoard(shuraNamedLeader);

    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");
    expect(blockerPromptPending(engine)).toBe(false);
  });

  test("an ordinary Leader is still blockable", () => {
    const engine = fuzaBoard();

    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");
    expect(blockerPromptPending(engine)).toBe(true);
  });

  test("[Opponent's Turn] your [Shura] and this Character both reach base power 6000", () => {
    // The exact numbers are what kill `value: 6000 -> 5000` on each of the two actions
    // independently: Shura would read 5000 under the first mutant and Fuza 5000 under the second,
    // and neither is 6000. Shura CLIMBS 2000 -> 6000 while Fuza climbs 4000 -> 6000, from
    // different printed bases to the same literal, which is the thing `modifyPower` cannot do at
    // any single value.
    const engine = fuzaBoardOnOpponentTurn();

    expect(characterPower(engine, op05Shura106)).toBe(6000);
    expect(characterPower(engine, op15Fuza070)).toBe(6000);
  });

  test("[Opponent's Turn] a non-[Shura] Character and an ordinary Leader are untouched", () => {
    // The negative control for the name filter, on both zones at once. Delete
    // `{ filter: "name", value: "Shura" }` and Namule (5000) and the Leader (5000) both become
    // 6000; without this assertion that mutant survives, because every card the test looks at
    // would be a legal target.
    const engine = fuzaBoardOnOpponentTurn();

    expect(characterPower(engine, op03Namule007)).toBe(5000);
    expect(leaderPower(engine)).toBe(5000);
  });

  test("on YOUR own turn the base power clause is off", () => {
    // The [Opponent's Turn] gate. `condition: "turn"` has no mutation operator, so this is the
    // only thing separating "6000 during the opponent's turn" from "6000 always" -- and the
    // difference matters, because the whole point of the clause is that it defends.
    const engine = fuzaBoard();

    expect(characterPower(engine, op05Shura106)).toBe(2000);
    expect(characterPower(engine, op15Fuza070)).toBe(4000);
  });

  test("ruling #909: a Leader named [Shura] reaches base power 6000 as well", () => {
    // 是的. The twin of the [Unblockable] ruling test above, and what pins
    // `zones: ["leader", "character"]` on the base-power action too -- dropping "leader" reads
    // perfectly naturally ("all of your [Shura] cards") and is wrong.
    const engine = fuzaBoardOnOpponentTurn(shuraNamedLeader);

    expect(leaderPower(engine)).toBe(6000);
  });
});
