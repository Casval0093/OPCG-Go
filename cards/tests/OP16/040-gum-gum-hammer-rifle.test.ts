import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb02Jonathan043,
  op02Kingdew006,
  op02Yamakaji116,
  op03Namule007,
  op09Mr3Galdino056,
  op11Saldeath064,
  op16GumGumHammerRifle040,
  op16MonkeyDLuffy022,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Opponent bodies, all genuinely vanilla:
//   op02Yamakaji116   cost 3, rested  -- clear of the boundary
//   op11Saldeath064   cost 6, rested  -- ON the boundary; the only fixture that pins "6"
//   eb02Jonathan043   cost 7, rested  -- excluded by the cost filter
//   op03Namule007     cost 3, ACTIVE  -- excluded by the state filter
//
// The two synthetics below exist to give the SECOND `zone: "field"` condition a Leader of its own.
// Rulings #979/#993 establish that "if you have [Name]" counts the Leader, and a statically-named
// Leader reproduces exactly what a name grant would look like to cardNames() (effects/shared.ts)
// with no `grantName` action needed. Without this, narrowing the Mr.3 condition to
// `zone: "character"` would be undetectable, because no printed Leader is named Mr.3(Galdino).
const mr3NamedLeader: LeaderCard = {
  ...op16MonkeyDLuffy022,
  id: "TEST-OP16-040-MR3-LEADER",
  canonicalId: "TEST-OP16-040-MR3-LEADER",
  name: "Mr.3(Galdino)",
  i18n: { en: { ...op16MonkeyDLuffy022.i18n.en, name: "Mr.3(Galdino)" } },
};

const luffyCharacter: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP16-040-LUFFY",
  canonicalId: "TEST-OP16-040-LUFFY",
  name: "Monkey.D.Luffy",
  i18n: { en: { ...op03Namule007.i18n.en, name: "Monkey.D.Luffy" } },
};

registerCards([mr3NamedLeader, luffyCharacter]);

const opponentBoard = [
  { card: op02Yamakaji116, rested: true },
  { card: op11Saldeath064, rested: true },
  { card: eb02Jonathan043, rested: true },
  op03Namule007,
];

describe("OP16-040 Gum-Gum Hammer Rifle", () => {
  test("with both names on your field, freezes a rested opponent Character of cost 6 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        // The Leader itself supplies [Monkey.D.Luffy] -- which is why narrowing that condition to
        // `zone: "character"` would break this test.
        leaderCardId: op16MonkeyDLuffy022,
        hand: [op16GumGumHammerRifle040],
        character: [op09Mr3Galdino056],
        activeDon: 1,
      },
      { leaderCardId: op16PortgasDAce001, character: opponentBoard },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const yamakajiId = engine.findCardInZone("north", "character", op02Yamakaji116);
    const saldeathId = engine.findCardInZone("north", "character", op11Saldeath064);
    const jonathanId = engine.findCardInZone("north", "character", eb02Jonathan043);
    const activeId = engine.findCardInZone("north", "character", op03Namule007);

    engine.playCard(op16GumGumHammerRifle040, "south");

    const freeze = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (freeze?.kind !== "selectEntity") throw new Error("Expected the freeze target choice.");
    expect(freeze.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [yamakajiId, saldeathId].sort(),
    );
    expect(freeze.candidates.map((candidate) => candidate.ref.id)).not.toContain(jonathanId);
    expect(freeze.candidates.map((candidate) => candidate.ref.id)).not.toContain(activeId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [saldeathId] }, "south");

    // "will not become active in your opponent's next Refresh Phase": hand the turn over and the
    // frozen body alone stays rested, while its neighbour refreshes as normal.
    engine.endTurn("south");
    const state = engine.getState();
    expect(state.cards[saldeathId]?.rested).toBe(true);
    expect(state.cards[yamakajiId]?.rested).toBe(false);
    expect(state.cards[jonathanId]?.rested).toBe(false);
  });

  test("rulings #979/#993: a Leader named Mr.3(Galdino) satisfies that half by itself", () => {
    // The mirror of the test above: here the Leader supplies [Mr.3(Galdino)] and a Character
    // supplies [Monkey.D.Luffy], so it is the SECOND condition's `zone: "field"` that is load-
    // bearing. Both conditions are separate objects and each is narrowed independently by the
    // mutation checker, so both need a case where the Leader is the only match.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: mr3NamedLeader,
        hand: [op16GumGumHammerRifle040],
        character: [luffyCharacter],
        activeDon: 1,
      },
      { leaderCardId: op16PortgasDAce001, character: opponentBoard },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op16GumGumHammerRifle040, "south");

    const freeze = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(freeze?.kind).toBe("selectEntity");
  });

  test("ruling #986: your OPPONENT holding Mr.3(Galdino) does not satisfy the condition", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16MonkeyDLuffy022,
        hand: [op16GumGumHammerRifle040],
        activeDon: 1,
      },
      {
        leaderCardId: op16PortgasDAce001,
        // The only Mr.3(Galdino) in the game is on the opponent's field. #986 answers 不能.
        character: [...opponentBoard, op09Mr3Galdino056],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const restedBefore = engine
      .getState()
      .players.north.characterArea.filter((entry): entry is string => entry !== null)
      .filter((instanceId) => engine.getState().cards[instanceId]?.rested);

    engine.playCard(op16GumGumHammerRifle040, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    engine.endTurn("south");
    // Nothing was frozen, so every rested body refreshed.
    expect(restedBefore).toHaveLength(3);
    for (const instanceId of restedBefore) {
      expect(engine.getState().cards[instanceId]?.rested).toBe(false);
    }
  });

  test("[Counter] +3000 holds a 7000-power attack off the Leader", () => {
    // Ace's 5000-power Leader plus 3000 is 8000 against a 7000 attacker; the mutation to +2000
    // leaves it at exactly 7000, which `attackPower >= defensePower` lets through.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16GumGumHammerRifle040, eb01Doma005],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const eventId = engine.findCardInZone("north", "hand", op16GumGumHammerRifle040);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });
});
