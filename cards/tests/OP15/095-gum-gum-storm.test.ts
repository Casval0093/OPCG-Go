import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op15Brook022,
  op15GumGumStorm095,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15GumGumStorm095;

// op15Brook022 is the [Straw Hat Crew] Leader used throughout; its own encoded [Activate: Main] is
// inert unless activated, so it is safe scenery.
function stormWithTrash(trashCount: number, leader = op15Brook022) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: leader,
      hand: [CARD],
      activeDon: 2,
      trash: Array.from({ length: trashCount }, () => op03Genzo046),
    },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-095 Gum-Gum Storm", () => {
  test("ruling #930: 14 cards already in the trash is enough, because the Event counts itself", () => {
    // The Event is moved to the trash BEFORE its enqueued [Main] resolves (engine/commands.ts calls
    // enqueueEffectsForTrigger, then moveCard, and the effect resolves off the queue afterwards), so
    // 14 + this card = 15. Encoding 14 to "compensate" would be wrong and this test is what says so.
    const engine = stormWithTrash(14);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    expect(engine.getView("south").players.south.leader.power).toBe(8000);
    expect(engine.getView("south").players.south.restedDon).toBe(2);
  });

  test("13 cards in the trash is one short and the effect does not fire", () => {
    // 13 + this card = 14 < 15. Pins the threshold from below.
    const engine = stormWithTrash(13);

    engine.playCard(CARD, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("the [Main] boost is restricted to [Straw Hat Crew] cards", () => {
    // Krieg's Leader is East Blue / Krieg Pirates, so with a non-Straw-Hat Leader and no Straw Hat
    // Characters there is no legal target and no prompt. Drop the trait filter and the Leader becomes
    // a candidate, so this goes red.
    const engine = stormWithTrash(14, op15Krieg001);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").players.south.leader.power).toBe(5000);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[Counter] has no trait filter and no DON!! cost -- any Leader or Character, +4000", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        character: [op02Atmos003],
        trash: Array.from({ length: 14 }, () => op03Genzo046),
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(boost?.kind).toBe("selectEntity");
    if (boost?.kind !== "selectEntity") throw new Error("Expected the Counter boost target.");
    const candidateIds = boost.candidates.map((candidate) => candidate.ref.id);
    // Neither the Krieg Leader nor Atmos is Straw Hat Crew, and both must still be offered here --
    // that is the difference from the [Main] half.
    expect(candidateIds).toContain(engine.leader("north"));
    expect(candidateIds).toContain(atmosId);
  });
});
