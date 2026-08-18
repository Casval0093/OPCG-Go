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
import { OnePieceTestEngine } from "../../../src/index.ts";

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
});
