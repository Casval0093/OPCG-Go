import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01MountainGod018,
  op10TrafalgarLaw119,
  op16Buggy041,
  op16CaptainBuggySOurSavior057,
  op16Jozu007,
  op16Namule010,
  op16PrisonerOfImpelDown042,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-057 Captain Buggy's Our Savior!!", () => {
  // Both Counter tests attack a Prisoner of Impel Down (6000 power) with a 9000-power
  // attacker, rather than the Leader: attacking a Leader deals Life damage regardless of
  // power, so the "thisBattle" modifier this Counter grants would have no observable game
  // effect there and (like the engine's own op04-095-barrier.test.ts) would have already
  // expired by the time the battle resolution returns control to the test. Targeting a
  // Character makes the +4000 mechanically observable: 9000 power normally K.O.s a
  // 6000-power defender, but not a 10000-power one.
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

  test("with only 1 Prisoner of Impel Down on field, the Counter's power boost does not trigger", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
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

    // The condition failed, so the modifyPower action never ran: no target prompt, and the
    // unboosted 6000-power Prisoner loses to the 9000-power attacker as normal. The event is
    // still played and trashed -- only its internal effect is gated by the condition, not
    // the ability to play a [Counter] event at all.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(
      view.players.north.characters.some((card) => card?.instanceId === targetPrisonerId),
    ).toBe(false);
    expect(view.players.north.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([targetPrisonerId, eventId]),
    );
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
