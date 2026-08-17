import { describe, expect, test } from "vite-plus/test";
import {
  op02Crocodile053,
  op02LittleoarsJr020,
  op16Buggy031,
  op16PrisonerOfImpelDown042,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op16PrisonerOfImpelDown042 is the only card in the game with this name, so there is no
// substitute fixture for the name filter. Using an OP16 card as a fixture is safe here
// specifically because its whole printed text is a deck-building rule ("you may have any
// number of this card in your deck") -- there is no in-match behaviour for a later batch to
// switch on.

describe("OP16-031 Buggy", () => {
  test("a battle K.O. plays a [Prisoner of Impel Down] from hand -- and only a card with that NAME", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Buggy031, rested: true }],
        // op02Crocodile053 carries the "Impel Down" TRAIT, which Buggy also has -- so a
        // trait-filtered encoding would wrongly offer it and this assertion would go red.
        hand: [op16PrisonerOfImpelDown042, op02Crocodile053],
      },
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const buggyId = engine.findCardInZone("south", "character", op16Buggy031);
    const attackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const namedId = engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042);
    const sameTraitId = engine.findCardInZone("south", "hand", op02Crocodile053);

    // 9000 into a rested 5000. South's hand is non-empty, so the counter step opens first.
    engine.declareAttack(attackerId, buggyId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Buggy's [On K.O.] hand-play.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([namedId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(sameTraitId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [namedId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === namedId)).toBe(true);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(buggyId);
    // It is played for free: south never had any DON!! to pay a cost-6 body with.
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([sameTraitId]);
    expect(view.prompts).toHaveLength(0);
  });

  test("with no [Prisoner of Impel Down] in hand the K.O. offers nothing at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Buggy031, rested: true }],
        hand: [op02Crocodile053],
      },
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const buggyId = engine.findCardInZone("south", "character", op16Buggy031);
    const attackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);

    engine.declareAttack(attackerId, buggyId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    // An `upTo` target with zero legal candidates publishes no prompt at all.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      buggyId,
    );
  });
});
