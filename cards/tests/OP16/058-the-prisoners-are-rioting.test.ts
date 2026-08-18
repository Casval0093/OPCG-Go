import { describe, expect, test } from "vite-plus/test";
import {
  op03Namule007,
  op12Buggy049,
  op12Issho082,
  op16Buggy041,
  op16ThePrisonersAreRioting058,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [Counter] half of this card is encoded; the [Main] is parked on a missing
// literal-valued base-power action (see the PARKED note on the card itself).
//
// op12Buggy049 is a genuinely vanilla Character named Buggy at 7000 power; op03Namule007 is the
// same-shaped body under a different name; op12Issho082 is a vanilla 10000-power attacker. The
// Leader is OP16-041 Buggy, whose own ability is a [DON!! x1] removal trigger and stays silent
// with no DON!! attached.

describe("OP16-058 The Prisoners Are Rioting!!", () => {
  test("[Counter] +4000 on a [Buggy] survives a 10000-power attacker", () => {
    // 7000 + 4000 = 11000 against 10000, so Buggy lives. Mutated to +3000 he sits at exactly
    // 10000 and `attackPower >= defensePower` K.O.s him -- which is the only way the magnitude is
    // observable, since a `thisBattle` modifier is gone by the time control returns here.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16ThePrisonersAreRioting058],
        character: [{ card: op12Buggy049, rested: true }, op03Namule007],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op12Issho082);
    const buggyId = engine.findCardInZone("north", "character", op12Buggy049);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const eventId = engine.findCardInZone("north", "hand", op16ThePrisonersAreRioting058);

    engine.declareAttack(attackerId, buggyId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (boost?.kind !== "selectEntity") throw new Error("Expected the +4000 recipient choice.");
    // "your [Buggy]" is a card, so the Leader (also named Buggy) is offered -- and Namule, a
    // Character on the same field, is not: the name filter is the only difference between them.
    expect(boost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), buggyId].sort(),
    );
    expect(boost.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buggyId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.characters.some((card) => card?.instanceId === buggyId)).toBe(true);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
  });

  test("without the [Counter] the same attacker K.O.s that Buggy", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16ThePrisonersAreRioting058],
        character: [{ card: op12Buggy049, rested: true }, op03Namule007],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const buggyId = engine.findCardInZone("north", "character", op12Buggy049);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op12Issho082),
      buggyId,
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    expect(
      engine.getView("north").players.north.characters.some((card) => card?.instanceId === buggyId),
    ).toBe(false);
  });
});
