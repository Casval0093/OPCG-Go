import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, StageCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Atmos003,
  op05Shura106,
  op15HeavenlyWarriors068,
  op15Satori066,
  op15Yama073,
  op16MobyDick021,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Only one [Heavenly Warriors] card exists and it is cost 1, so the "cost of 1" half of the FIRST
// disjunct has no printed counter-example anywhere in the pool. A cost-2 twin supplies it: without
// it, deleting that group's cost filter (or flipping `eq` to `gte`) changes nothing observable.
const costTwoHeavenlyWarriors: CharacterCard = {
  ...op15HeavenlyWarriors068,
  id: "TEST-OP15-073-HW-COST-2",
  canonicalId: "TEST-OP15-073-HW-COST-2",
  cost: 2,
};

// The second disjunct prints "Character card" (角色卡牌). A `play` action's candidate pool is
// already pre-filtered to stage-or-character (candidatesForPlayAction), so the ONLY thing that
// filter can exclude is a Stage -- and no cost-1 [Vassals] Stage exists to exclude. An Event
// fixture here would be vacuous: it is unreachable through a play action either way.
const vassalsStage: StageCard = {
  ...op16MobyDick021,
  id: "TEST-OP15-073-VASSALS-STAGE",
  canonicalId: "TEST-OP15-073-VASSALS-STAGE",
  cost: 1,
  traits: ["Vassals"],
  effects: undefined,
};

registerCards([costTwoHeavenlyWarriors, vassalsStage]);

function yamaOnPlay() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      hand: [
        op15Yama073,
        // Group 1 match: the cost-1 [Heavenly Warriors].
        op15HeavenlyWarriors068,
        // Group 2 match: a cost-1 [Vassals] Character.
        op15Satori066,
        // Neither group: cost 1 but no matching name or trait -- kills "delete the name filter"
        // and "delete the trait filter", both of which would let any cost-1 card in.
        eb01Doma005,
        // Ruling #912's counter-examples, one per disjunct.
        op05Shura106,
        costTwoHeavenlyWarriors,
        vassalsStage,
      ],
      activeDon: op15Yama073.cost,
      donDeckCount: 10 - op15Yama073.cost,
    },
    { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "south" },
  );
}

describe("OP15-073 Yama", () => {
  test("ruling #912: only the cost-1 [Heavenly Warriors] and the cost-1 [Vassals] Character are playable", () => {
    // 不可以 for a cost-2-or-more [Heavenly Warriors] or [Vassals] Character. "a cost of 1"
    // (费用为1) is an equality, not a ceiling.
    const engine = yamaOnPlay();
    const warriorsId = engine.findCardInZone("south", "hand", op15HeavenlyWarriors068);
    const satoriId = engine.findCardInZone("south", "hand", op15Satori066);

    engine.playCard(op15Yama073, "south");

    const pick = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Yama's play choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [warriorsId, satoriId].sort(),
    );

    engine.resolveDecision("effectPlaySelection", { selectedIds: [warriorsId] }, "south");
    expect(engine.getState().players.south.characterArea).toContain(warriorsId);
    // Played by an effect, so no DON!! is spent beyond Yama's own cost.
    expect(engine.getState().players.south).toMatchObject({ activeDon: 0, restedDon: 3 });
  });

  test("the [Vassals] branch really is playable, not just listed", () => {
    const engine = yamaOnPlay();
    const satoriId = engine.findCardInZone("south", "hand", op15Satori066);

    engine.playCard(op15Yama073, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [satoriId] }, "south");
    // Satori's own [On Play] DON!! -1 fires on arrival -- declined here, since this test is
    // about Yama's play action rather than Satori's draw.
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().players.south.characterArea).toContain(satoriId);
  });

  test('"up to 1" may be declined', () => {
    const engine = yamaOnPlay();

    engine.playCard(op15Yama073, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(
      engine.getState().players.south.characterArea.filter((entry) => entry !== null),
    ).toHaveLength(1);
  });

  test("[Blocker] is a printed keyword", () => {
    const engine = yamaOnPlay();

    engine.playCard(op15Yama073, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "south");
    const yamaId = engine.findCardInZone("south", "character", op15Yama073);

    engine.endTurn("south");
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      engine.leader("south"),
      "north",
    );

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Yama's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(yamaId);
  });
});
