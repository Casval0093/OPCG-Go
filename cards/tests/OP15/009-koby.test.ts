import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02LittleoarsJr020,
  op02Smoker093,
  op03Namule007,
  op15Koby009,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Same technique as tests/cards/OP16/014-marco.test.ts: a minimal 0-cost [On Play] "return 1
// Character to the owner's hand" so a removeFromField can be driven from either seat without
// depending on some other set's removal card.
function makeReturner(id: string): CharacterCard {
  return {
    ...eb01Doma005,
    id,
    canonicalId: id,
    cost: 0,
    effects: {
      effects: [
        {
          trigger: "onPlay",
          actions: [
            {
              action: "returnToHand",
              target: { player: "any", zones: ["character"], count: { amount: 1 } },
            },
          ],
        },
      ],
    },
  };
}

const opponentReturner = makeReturner("TEST-OP15-009-OPPONENT-RETURN");
const ownReturner = makeReturner("TEST-OP15-009-OWN-RETURN");

// The basePower-vs-power discriminator. `mutation_check.py` has NO operator that rewrites one
// filter into the other, so both readings stay green on any board built from vanilla fixtures.
// This body's PRINTED power is 5000 (inside "7000 base power or less") while its CURRENT power is
// 9000 (outside it), so `basePower` protects it and `power` would not. The permanent modifier has
// to be `self: true`: getPermanentModifierTotal drops anything that is neither `self` nor
// `count.amount: "all"`.
const buffedLowBaseBody: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP15-009-BUFFED-5000-BASE",
  canonicalId: "TEST-OP15-009-BUFFED-5000-BASE",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 4000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([opponentReturner, ownReturner, buffedLowBaseBody]);

function kobyBoard(character: PlayerFixture["character"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op02Smoker093, character },
    { leaderCardId: op02Smoker093, hand: [opponentReturner], activeDon: 3 },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

describe("OP15-009 Koby", () => {
  test("an opponent's removal of a 5000-base Character can be replaced by exactly -2000 on your Leader", () => {
    const engine = kobyBoard([op15Koby009, op03Namule007]);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op03Namule007)).toBe(namuleId);
    // The MAGNITUDE, hand-pinned: `value: -2000` is negative, so the numeric mutation operator
    // (`value:\s*(\d{3,6})`) never generates a mutant for it. Smoker prints 5000.
    expect(view.players.south.leader.power).toBe(3000);
  });

  test("the -2000 is `thisTurn` and expires", () => {
    const engine = kobyBoard([op15Koby009, op03Namule007]);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.endTurn("north");

    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("ruling #860: Koby may save ITSELF", () => {
    // 可以. Koby is 2000 base, so it is inside its own threshold and the printed "your Character"
    // does not exclude it. Add an `excludeSelf` filter -- the obvious defensive move, and the exact
    // mistake OP16-045/OP16-050 document -- and this goes red.
    const engine = kobyBoard([op15Koby009]);
    const kobyId = engine.findCardInZone("south", "character", op15Koby009);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kobyId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.findCardInZone("south", "character", op15Koby009)).toBe(kobyId);
    expect(engine.getView("south").players.south.leader.power).toBe(3000);
  });

  test("exactly 7000 base is on the line and is protected", () => {
    // Below-the-line bodies prove the filter exists; only an ON-the-line body proves the number.
    // This is what kills `value: 7000 -> 6000`.
    const engine = kobyBoard([op15Koby009, op02Kingdew006]);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.findCardInZone("south", "character", op02Kingdew006)).toBe(kingdewId);
  });

  test("a 9000-base Character is over the line and is not offered the replacement", () => {
    // Kills both `delete filter:basePower` and `comparison: "lte" -> "gte"`.
    const engine = kobyBoard([op15Koby009, op02LittleoarsJr020]);
    const oarsId = engine.findCardInZone("south", "character", op02LittleoarsJr020);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [oarsId] }, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "hand", op02LittleoarsJr020)).toBeTruthy();
  });

  test("原本的力量: a 5000-base body buffed to 9000 is still protected", () => {
    // The `basePower` vs `power` discriminator. Under a `power lte 7000` misreading this body is
    // 9000 and no prompt appears; under the correct `basePower` reading it is 5000 and protected.
    // Nothing in the mutation report covers this -- there is no operator that swaps the two.
    const engine = kobyBoard([op15Koby009, buffedLowBaseBody]);
    const buffedId = engine.findCardInZone("south", "character", buffedLowBaseBody);
    expect(
      engine.getView("south").players.south.characters.find((c) => c?.instanceId === buffedId)
        ?.power,
    ).toBe(9000);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buffedId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    expect(engine.findCardInZone("south", "character", buffedLowBaseBody)).toBe(buffedId);
  });

  test('declining lets the Character go -- it is a "may"', () => {
    const engine = kobyBoard([op15Koby009, op03Namule007]);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(opponentReturner, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    expect(engine.findCardInZone("south", "hand", op03Namule007)).toBeTruthy();
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test('`source: "opponentEffect"`: your OWN effect removing your own Character is not replaceable', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [op15Koby009, op03Namule007],
        hand: [ownReturner],
        activeDon: 3,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(ownReturner, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.findCardInZone("south", "hand", op03Namule007)).toBeTruthy();
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("a battle K.O. is NOT replaceable -- the printed cause is the opponent's EFFECT", () => {
    // 因对方的**效果**, so `replacedEvent: "removeFromField"` is correct and `leaveField` -- the
    // value OP15-098 needed for its cause-agnostic wording -- would be wrong here: `leaveField` is
    // in findKoReplacement's battle set and would wrongly fire on this attack.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        character: [op15Koby009, { card: op03Namule007, rested: true }],
      },
      { leaderCardId: op02Smoker093, character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(kingdewId, namuleId, "north");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      namuleId,
    );
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });
});
