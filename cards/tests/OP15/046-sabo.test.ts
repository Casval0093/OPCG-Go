import { describe, expect, test } from "vite-plus/test";
import {
  op01Bellamy076,
  op02Seaquake021,
  op02Smoker093,
  op02Thatch007,
  op04Rebecca039,
  op10GumGumRhinoSchneider097,
  op15Sabo046,
} from "@tcg/op-cards";

import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// Hand fixtures for the [On Play], each isolating one filter:
//   op10GumGumRhinoSchneider097  EVENT,     [Dressrosa]        -- the only legal target, and its
//                                                                [Main] is observable: +2000
//                                                                thisTurn to a [Dressrosa]
//                                                                Character, which Sabo is
//   op02Seaquake021              EVENT,     Whitebeard Pirates -- excluded by `trait` alone
//   op01Bellamy076               CHARACTER, [Dressrosa]        -- excluded by `cardCategory`
//                                                                ALONE. `activateEvent`'s
//                                                                candidate pool is NOT
//                                                                pre-narrowed by card type
//                                                                (unlike `play`), so a Character
//                                                                is a genuine false positive here
function saboWithLeader(leaderCardId: CardRef) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op15Sabo046, op10GumGumRhinoSchneider097, op02Seaquake021, op01Bellamy076],
      activeDon: 7,
    },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-046 Sabo", () => {
  test("[On Play] activates a [Dressrosa] Event from hand under a [Dressrosa] Leader", () => {
    const engine = saboWithLeader(op04Rebecca039);
    const rhinoId = engine.findCardInZone("south", "hand", op10GumGumRhinoSchneider097);
    const wrongTraitId = engine.findCardInZone("south", "hand", op02Seaquake021);
    const wrongCategoryId = engine.findCardInZone("south", "hand", op01Bellamy076);

    engine.playCard(op15Sabo046, "south");
    const saboId = engine.findCardInZone("south", "character", op15Sabo046);

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected Sabo's Event choice.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([rhinoId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongTraitId);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      wrongCategoryId,
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [rhinoId] }, "south");

    // The chosen Event's own [Main] now resolves, which is what proves it was ACTIVATED rather
    // than merely discarded: +2000 during this turn to up to 1 [Dressrosa] Character.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [saboId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === saboId)?.power).toBe(
      11000,
    );
    // Ruling #895: unless the Event's own text says otherwise it ends up in the trash.
    expect(engine.getState().players.south.trash).toContain(rhinoId);
    expect(view.prompts).toHaveLength(0);
  });

  test("under a non-[Dressrosa] Leader the whole block is skipped -- no prompt at all", () => {
    // The [Dressrosa] check LEADS the printed sentence, so it gates the block, not just the
    // action. Move it onto the action instead and a prompt appears here.
    const engine = saboWithLeader(op02Smoker093);
    const rhinoId = engine.findCardInZone("south", "hand", op10GumGumRhinoSchneider097);

    engine.playCard(op15Sabo046, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toContain(rhinoId);
  });

  test('"up to 1" may be declined', () => {
    const engine = saboWithLeader(op04Rebecca039);
    const rhinoId = engine.findCardInZone("south", "hand", op10GumGumRhinoSchneider097);

    engine.playCard(op15Sabo046, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(rhinoId);
  });

  test("the printed [Blocker] works", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op04Rebecca039, character: [op15Sabo046] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const saboId = engine.findCardInZone("south", "character", op15Sabo046);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([saboId]);
  });
});
