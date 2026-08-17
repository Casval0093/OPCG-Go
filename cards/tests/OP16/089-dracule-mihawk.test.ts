import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01MountainGod018,
  op03Nero087,
  op12Issho082,
  op16DraculeMihawk089,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-089 Dracule Mihawk", () => {
  test("draws 2, trashes the chosen 2, then takes exactly 4 off one opposing Character for this turn only", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16DraculeMihawk089, eb01Doma005],
        deck: [eb01Fourtricks025, eb01MountainGod018, eb01Doma005],
        // op03Nero087 is our own Character. "your opponent's Characters" must exclude it, and
        // nothing else in this file would notice if `player` were "self" or "any".
        character: [op03Nero087],
        activeDon: op16DraculeMihawk089.cost,
      },
      { character: [op12Issho082] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const retainedId = engine.findCardInZone("south", "hand", eb01Doma005);
    const firstDrawId = engine.findCardInZone("south", "deck", eb01Fourtricks025);
    const secondDrawId = engine.findCardInZone("south", "deck", eb01MountainGod018);
    const ownCharacterId = engine.findCardInZone("south", "character", op03Nero087);
    // op12Issho082 is a printed cost-8 Character, so -4 has to land on a number well clear of
    // the zero floor (GENERAL ruling #37: a cost never goes below 0, which would mask the
    // magnitude on a cheap body).
    const targetId = engine.findCardInZone("north", "character", op12Issho082);
    expect(
      engine.getView("south").players.north.characters.find((card) => card?.instanceId === targetId)
        ?.cost,
    ).toBe(8);

    engine.playCard(op16DraculeMihawk089, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Mihawk's hand-trash choice.");
    // Exactly 2, not "up to 2": the printed line is mandatory once the card is played.
    expect(trash).toMatchObject({ min: 2, max: 2 });
    // The two freshly drawn cards are in hand and trashable, which is what proves the draw
    // happened before the trash rather than after it.
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toEqual(
      expect.arrayContaining([retainedId, firstDrawId, secondDrawId]),
    );
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [firstDrawId, secondDrawId] },
      "south",
    );

    const cost = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(cost?.kind).toBe("selectEntity");
    if (cost?.kind !== "selectEntity") throw new Error("Expected Mihawk's cost-debuff target.");
    expect(cost).toMatchObject({ min: 0, max: 1 });
    expect(cost.candidates.map((candidate) => candidate.ref.id)).toEqual([targetId]);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(ownCharacterId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");

    let view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([retainedId]);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([firstDrawId, secondDrawId]),
    );
    // 8 - 4. Pins the magnitude, not just which Character was chosen: a -3 or -5 encoding
    // fails here. `ProjectedCard.cost` is getCardCost(), so a `thisTurn` cost modifier is
    // readable straight off the projection (unlike a `thisBattle` power modifier).
    expect(view.players.north.characters.find((card) => card?.instanceId === targetId)?.cost).toBe(
      4,
    );

    engine.endTurn("south");
    view = engine.getView("north");
    expect(view.players.north.characters.find((card) => card?.instanceId === targetId)?.cost).toBe(
      8,
    );
  });

  test("[Rush: Character] attacks an opposing Character the turn it is played, but not the Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16DraculeMihawk089, eb01Doma005, eb01Fourtricks025],
        // Four, not two: drawing the deck to exactly 0 ends the match before the attack can be
        // declared, and the resulting failure ("Attacks can only be declared during your main
        // phase") looks nothing like the keyword restriction this test is about.
        deck: [eb01Doma005, eb01Fourtricks025, eb01Doma005, eb01Fourtricks025],
        activeDon: op16DraculeMihawk089.cost,
      },
      // eb01MountainGod018 is 7000 power, under Mihawk's printed 8000, and rested so it is a
      // legal attack target at all (an active Character cannot be attacked).
      { character: [{ card: eb01MountainGod018, rested: true, playedOnTurn: 0 }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const targetId = engine.findCardInZone("north", "character", eb01MountainGod018);

    engine.playCard(op16DraculeMihawk089, "south");
    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected Mihawk's hand-trash choice.");
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: trash.candidates.slice(0, 2).map((candidate) => candidate.ref.id) },
      "south",
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");
    const mihawkId = engine.findCardInZone("south", "character", op16DraculeMihawk089);

    // The half of `rushCharacter` that distinguishes it from plain `rush`: the Leader is still
    // off limits on the turn Mihawk is played. Encoding this as `keywords: ["rush"]` would
    // make this attack legal.
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: mihawkId,
        targetId: engine.leader("north"),
      }).reason,
    ).toContain("cannot be attacked");

    // ...and the half that distinguishes it from no keyword at all.
    engine.declareAttack(mihawkId, targetId, "south");
    expect(engine.getView("south").players.north.trash.map((card) => card.instanceId)).toContain(
      targetId,
    );
  });
});
