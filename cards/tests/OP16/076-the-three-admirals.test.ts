import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Thatch007,
  op03Namule007,
  op16PortgasDAce001,
  op16TheThreeAdmirals076,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The engine's pre-OP15 pool contains NO card with the "Admiral" trait at all -- OP16 is where it
// arrives -- so the three Admiral bodies have to be synthetic. Each is spread from a genuinely
// vanilla 5000-power Character, so nothing but this event can change a power number, and each gets
// a distinct name because `differentNames`-style checks and `cardName()` read different fields.
function admiral(suffix: string): CharacterCard {
  return {
    ...op03Namule007,
    id: `TEST-OP16-076-ADMIRAL-${suffix}`,
    canonicalId: `TEST-OP16-076-ADMIRAL-${suffix}`,
    name: `Admiral ${suffix}`,
    traits: ["Admiral"],
    i18n: { en: { ...op03Namule007.i18n.en, name: `Admiral ${suffix}` } },
  };
}

const admiralA = admiral("A");
const admiralB = admiral("B");
const admiralC = admiral("C");

registerCards([admiralA, admiralB, admiralC]);

describe("OP16-076 The Three Admirals!!", () => {
  test("[Main] rests 3 DON!! and gives up to 3 [Admiral] Characters +2000 for the turn", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16TheThreeAdmirals076],
        character: [
          { card: admiralA, playedOnTurn: 0 },
          { card: admiralB, playedOnTurn: 0 },
          { card: admiralC, playedOnTurn: 0 },
          // Not an Admiral: without it, deleting the trait filter would change nothing observable.
          { card: op03Namule007, playedOnTurn: 0 },
        ],
        // 1 for the event, 3 for the cost.
        activeDon: 4,
      },
      { character: [{ card: op02Kingdew006, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const admiralAId = engine.findCardInZone("south", "character", admiralA);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const defenderId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.playCard(op16TheThreeAdmirals076, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const boost = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (boost?.kind !== "selectEntity") throw new Error("Expected the +2000 recipients.");
    expect(boost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [
        admiralAId,
        engine.findCardInZone("south", "character", admiralB),
        engine.findCardInZone("south", "character", admiralC),
      ].sort(),
    );
    expect(boost.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [admiralAId] }, "south");

    expect(engine.getState().players.south.activeDon).toBe(0);
    expect(engine.getState().players.south.restedDon).toBe(4);

    // The magnitude decides a battle rather than being read off a projection: 5000 + 2000 = 7000
    // against a 7000-power defender is a K.O., because `attackPower >= defensePower` is a hit;
    // mutated to +1000 the attacker sits at 6000 and the defender lives.
    engine.declareAttack(admiralAId, defenderId, "south");
    expect(
      engine
        .getView("north")
        .players.north.characters.some((card) => card?.instanceId === defenderId),
    ).toBe(false);
  });

  test("[Counter] +4000 applies only when you have an [Admiral] type Character", () => {
    // 5000 + 4000 = 9000 against an 8000 attacker, so Namule lives; the mutation to +3000 leaves
    // him at exactly 8000 and he dies.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16TheThreeAdmirals076, eb01Doma005],
        character: [{ card: op03Namule007, rested: true }, admiralA],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const eventId = engine.findCardInZone("north", "hand", op16TheThreeAdmirals076);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Thatch007),
      namuleId,
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (boost?.kind !== "selectEntity") throw new Error("Expected the +4000 recipient.");
    // "your Leader or Character cards" -- unfiltered, so the non-Admiral Namule is a legal
    // recipient even though the Admiral is what unlocked the ability.
    expect(boost.candidates.map((candidate) => candidate.ref.id)).toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");

    expect(
      engine
        .getView("north")
        .players.north.characters.some((card) => card?.instanceId === namuleId),
    ).toBe(true);
  });

  test("[Counter] does nothing with no [Admiral] type Character on your field", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16TheThreeAdmirals076, eb01Doma005],
        character: [{ card: op03Namule007, rested: true }],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const eventId = engine.findCardInZone("north", "hand", op16TheThreeAdmirals076);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Thatch007),
      namuleId,
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    // The condition failed, so no recipient was ever asked for and the unboosted 5000 body loses
    // to the 8000 attacker. The event is still played and trashed.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north.characters.some((card) => card?.instanceId === namuleId)).toBe(false);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
  });
});
