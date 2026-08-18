import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb02MerryGo041,
  op01MonkeyDLuffy003,
  op02Atmos003,
  op02Usopp028,
  op06GeckoMoria080,
  op09Jinbe067,
  op15Nami086,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The vanilla [Straw Hat Crew] pool tops out at cost 7 (op09Jinbe067), so the over-the-line body
// that makes `delete filter:cost` killable has to be synthetic. Right about everything but cost.
const costEightStrawHat: CharacterCard = {
  ...op09Jinbe067,
  id: "TEST-OP15-086-COST-8",
  canonicalId: "TEST-OP15-086-COST-8",
  cost: 8,
};

registerCards([costEightStrawHat]);

// op09Jinbe067  cost 7, [Fish-Man Straw Hat Crew]  -- ON the line
// op02Usopp028  cost 3, [Film Straw Hat Crew]      -- under it; a `lte -> gte` mutation drops it
// costEightStrawHat cost 8                          -- kills delete filter:cost
// op02Atmos003  cost 4, [Whitebeard Pirates]        -- kills delete filter:trait
// eb02MerryGo041 cost 1 STAGE, [Straw Hat Crew]     -- kills delete filter:cardCategory
const TRASH = [op09Jinbe067, op02Usopp028, costEightStrawHat, op02Atmos003, eb02MerryGo041];

function namiInHand(leaderCardId: LeaderCard) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op15Nami086], trash: TRASH, deck: 10, activeDon: 10 },
    { deck: 10 },
    // South needs to be able to attack for the [Rush] proof below.
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-086 Nami", () => {
  test("the trash pool is exactly the [Straw Hat Crew] Characters at cost 7 or less", () => {
    const engine = namiInHand(op01MonkeyDLuffy003);
    const jinbeId = engine.findCardInZone("south", "trash", op09Jinbe067);
    const usoppId = engine.findCardInZone("south", "trash", op02Usopp028);
    const overCostId = engine.findCardInZone("south", "trash", costEightStrawHat);
    const atmosId = engine.findCardInZone("south", "trash", op02Atmos003);
    const merryGoId = engine.findCardInZone("south", "trash", eb02MerryGo041);

    engine.playCard(op15Nami086, "south");

    const step = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected Nami's play selection.");
    const candidateIds = step.candidates.map((candidate) => candidate.ref.id);

    expect([...candidateIds].sort()).toEqual([jinbeId, usoppId].sort());
    expect(candidateIds).not.toContain(overCostId);
    expect(candidateIds).not.toContain(atmosId);
    expect(candidateIds).not.toContain(merryGoId);
  });

  test("the Character played this way gains [Rush] and can attack the same turn", () => {
    // A granted keyword has no projected field, so this is proved functionally. Jinbe is played
    // from the trash on this turn and would otherwise be unable to attack at all.
    const engine = namiInHand(op01MonkeyDLuffy003);
    const jinbeTrashId = engine.findCardInZone("south", "trash", op09Jinbe067);

    engine.playCard(op15Nami086, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [jinbeTrashId] }, "south");

    expect(engine.getState().cards[jinbeTrashId]?.zone).toBe("character");
    // No extra target prompt: `previousActionTargets` binds the grant to the card just played
    // instead of opening a fresh choice.
    expect(
      engine
        .getState()
        .promptQueue.filter(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectTargetSelection",
        ),
    ).toHaveLength(0);

    engine.declareAttack(jinbeTrashId, engine.leader("north"), "south");

    expect(engine.getState().cards[jinbeTrashId]?.rested).toBe(true);
  });

  test("under a Leader without the type the effect never fires", () => {
    const engine = namiInHand(op06GeckoMoria080);

    engine.playCard(op15Nami086, "south");

    // No prompt at all, not an empty one -- the condition gates the whole block.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.trash).toHaveLength(TRASH.length);
  });
});
