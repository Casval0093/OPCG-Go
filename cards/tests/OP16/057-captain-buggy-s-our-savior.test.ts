import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb01MountainGod018,
  op02Blugori084,
  op10TrafalgarLaw119,
  op16Buggy041,
  op16CaptainBuggySOurSavior057,
  op16Jozu007,
  op16Namule010,
  op16PrisonerOfImpelDown042,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #993's hypothetical -- a Leader whose own effect grants it every card's name -- is
// simulated directly at the static level: a synthetic Leader literally named "Prisoner of
// Impel Down" reproduces exactly what such a grant would look like to cardNames()
// (shared.ts), with no dependency on a grantName action the engine doesn't have. cardName()
// (shared.ts) resolves from `i18n.en.name`, not the top-level `name` field, so both have to
// be overridden or the filter matches against the spread-from card's original name instead.
const prisonerNamedLeader: LeaderCard = {
  ...op16Buggy041,
  id: "TEST-OP16-057-PRISONER-LEADER",
  canonicalId: "TEST-OP16-057-PRISONER-LEADER",
  name: "Prisoner of Impel Down",
  i18n: { en: { ...op16Buggy041.i18n.en, name: "Prisoner of Impel Down" } },
};

registerCards([prisonerNamedLeader]);

describe("OP16-057 Captain Buggy's Our Savior!!", () => {
  // Both Counter tests attack a Prisoner of Impel Down (6000 power) with a 9000-power
  // attacker, rather than the Leader. A Leader attack IS still a power comparison
  // (battle.ts:414 gates all damage on attackPower >= defensePower, Leader or Character
  // alike -- see cards/ENCODING.md), but resolving the target-selection prompt completes
  // the whole battle atomically within that one call, so by the time control returns here
  // the "thisBattle" modifier has already expired -- `state.modifiers` would be empty
  // regardless of whether the boost mattered, the same reason
  // packages/engine/tests/cards/events/op04-095-barrier.test.ts never asserts
  // `leader.power` either. Targeting a Character instead makes the +4000 mechanically
  // observable through a durable outcome: 9000 power normally K.O.s a 6000-power defender,
  // but not a 10000-power one.
  test("with 2 Prisoner of Impel Down on field, the Counter's +4000 saves the attacked one", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16CaptainBuggySOurSavior057],
        // Only the Leader and rested Characters are legal attack targets.
        character: [
          { card: op16PrisonerOfImpelDown042, rested: true },
          { card: op16PrisonerOfImpelDown042, rested: true },
        ],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10TrafalgarLaw119);
    const eventId = engine.findCardInZone("north", "hand", op16CaptainBuggySOurSavior057);
    const targetPrisonerId = engine.getState().players.north.characterArea[0]!;
    const otherPrisonerId = engine.getState().players.north.characterArea[1]!;

    engine.declareAttack(attackerId, targetPrisonerId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const target = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(target?.kind).toBe("selectEntity");
    if (target?.kind !== "selectEntity") throw new Error("Expected Our Savior's power recipient.");
    expect(target.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), targetPrisonerId, otherPrisonerId].sort(),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetPrisonerId] }, "north");

    const view = engine.getView("north");
    // 6000 base + 4000 = 10000, beating the 9000-power attacker: the Prisoner survives.
    expect(
      view.players.north.characters.some((card) => card?.instanceId === targetPrisonerId),
    ).toBe(true);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
  });

  test("with only 1 Prisoner of Impel Down (plus an Impel Down Character with a different name), the boost does not trigger", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16CaptainBuggySOurSavior057],
        character: [
          { card: op16PrisonerOfImpelDown042, rested: true },
          // op02Blugori084 carries the "Impel Down" TRAIT (like this event itself, and like
          // Bunkov/Antlerkov/Buggy) but is NAMED "Blugori", not "Prisoner of Impel Down". If
          // the condition were wrongly filtering on the trait instead of the name, this
          // card would make the count 2 and the boost would incorrectly fire.
          //
          // This slot used to hold op16Buggy048, which was inert only because OP16-048 was
          // still unencoded. Its second clause is an [On Opponent's Attack] that grants
          // [Blocker] to a [Prisoner of Impel Down], so once encoded it jumps the queue ahead
          // of the battleCounter step here. op02Blugori084 is genuinely vanilla (pre-OP15, no
          // `effect` key at all), which is what this fixture always needed to be.
          op02Blugori084,
        ],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10TrafalgarLaw119);
    const eventId = engine.findCardInZone("north", "hand", op16CaptainBuggySOurSavior057);
    const targetPrisonerId = engine.findCardInZone(
      "north",
      "character",
      op16PrisonerOfImpelDown042,
    );

    engine.declareAttack(attackerId, targetPrisonerId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    // The condition failed (1 name-matching Character, not 2), so the modifyPower action
    // never ran: no target prompt, and the unboosted 6000-power Prisoner loses to the
    // 9000-power attacker as normal. The event is still played and trashed -- only its
    // internal effect is gated by the condition, not the ability to play a [Counter] event
    // at all.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(
      view.players.north.characters.some((card) => card?.instanceId === targetPrisonerId),
    ).toBe(false);
    expect(view.players.north.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([targetPrisonerId, eventId]),
    );
  });

  test('ruling #993: a Leader named "Prisoner of Impel Down" plus 1 real one on field satisfies "2 or more"', () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        leaderCardId: prisonerNamedLeader,
        hand: [op16CaptainBuggySOurSavior057],
        character: [{ card: op16PrisonerOfImpelDown042, rested: true }],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10TrafalgarLaw119);
    const eventId = engine.findCardInZone("north", "hand", op16CaptainBuggySOurSavior057);
    const targetPrisonerId = engine.findCardInZone(
      "north",
      "character",
      op16PrisonerOfImpelDown042,
    );

    engine.declareAttack(attackerId, targetPrisonerId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    // Fails before the zone: "field" fix -- zone: "character" structurally excludes the
    // Leader from the count, leaving only 1 name-matching Character and failing "gte 2"
    // even though the ruling says this exact setup (1 real + the Leader) should hold.
    const target = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(target?.kind).toBe("selectEntity");
  });

  test("[Trigger] draws 2 cards, then trashes 1 from hand", () => {
    const engine = OnePieceTestEngine.create(
      // Attacking a Leader is still a power comparison against its own power (5000 for
      // Buggy), not unconditional Life loss -- eb01MountainGod018 (7000) clears it,
      // eb01Doma005 (3000) would not.
      { character: [{ card: eb01MountainGod018, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [eb01Doma005],
        life: [op16CaptainBuggySOurSavior057],
        // A 3rd, never-drawn filler pads the total to 5+ cards: match creation peels
        // `leaderLife` (5, for Buggy) cards off the combined hand+deck+life+... pool before
        // this fixture's explicit per-zone placement runs, so the pool must be at least
        // that large regardless of how few cards this test actually needs in each zone.
        deck: [op16Jozu007, op16Namule010, eb01Doma005],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", eb01MountainGod018);
    const existingId = engine.findCardInZone("north", "hand", eb01Doma005);
    const firstDrawId = engine.findCardInZone("north", "deck", op16Jozu007);
    const secondDrawId = engine.findCardInZone("north", "deck", op16Namule010);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const trashDecision = engine.pendingDecision("effectTrashFromHandSelection", "north");
    const trashStep = trashDecision.steps[0];
    expect(trashStep?.kind).toBe("selectEntity");
    if (trashStep?.kind !== "selectEntity") {
      throw new Error("Expected the mandatory post-draw trash choice.");
    }
    expect(trashStep.candidates.map((candidate) => candidate.ref.id)).toEqual([
      existingId,
      firstDrawId,
      secondDrawId,
    ]);
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [firstDrawId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.hand.map((card) => card.instanceId)).toEqual([
      existingId,
      secondDrawId,
    ]);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(firstDrawId);
    expect(view.prompts).toHaveLength(0);
  });
});
