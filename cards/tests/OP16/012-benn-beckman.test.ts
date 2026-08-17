import { describe, expect, test } from "vite-plus/test";
import {
  op02Thatch007,
  op09HowlingGab006,
  op09Shanks001,
  op09Shanks004,
  op13MonkeyDLuffy001,
  op16BennBeckman012,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// op09Shanks001 is the only [Red-Haired Pirates] Leader in the pool; its own ability is an
// [On Your Opponent's Attack], inert on my own turn. op13MonkeyDLuffy001 ("Straw Hat Crew
// Supernovas") stands in for a Leader without the type.
//
// op09Shanks004 is the played card: a real Character named "Shanks" whose only abilities are a
// permanent power modifier and [Rush], so it enters play without publishing a prompt of its own.
// op09HowlingGab006 carries the [Red-Haired Pirates] TYPE but not the NAME -- it is what makes
// the `name` filter killable, exactly as a trait-vs-name mix-up would be invisible without it.
function southHand(activeDon: number) {
  return {
    leaderCardId: op09Shanks001,
    hand: [op16BennBeckman012, op09Shanks004, op09HowlingGab006],
    activeDon,
  };
}

describe("OP16-012 Benn.Beckman", () => {
  test("[On Play] with a Red-Haired Pirates Leader and exactly 10 DON!! plays [Shanks] from hand", () => {
    const engine = OnePieceTestEngine.create(southHand(10), {});
    const shanksId = engine.findCardInZone("south", "hand", op09Shanks004);
    const sameTraitDifferentNameId = engine.findCardInZone("south", "hand", op09HowlingGab006);

    engine.playCard(op16BennBeckman012, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // cost 5 rested by the play + 1 rested by the effect's cost; 10 DON!! total throughout.
    expect(engine.getView("south").players.south.restedDon).toBe(op16BennBeckman012.cost + 1);

    const choice = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected the [Shanks] play choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id)).toEqual([shanksId]);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      sameTraitDifferentNameId,
    );
    engine.resolveDecision("effectPlaySelection", { selectedIds: [shanksId] }, "south");

    expect(engine.getState().cards[shanksId]?.zone).toBe("character");
  });

  test("11 DON!! on the field does NOT satisfy '10 DON!! cards', but the cost is still paid", () => {
    // The DON!! deck holds ten, so `eq 10` and `gte 10` are behaviourally identical in real play
    // and the mutant is unkillable without an impossible count. `activeDon` is uncapped in the
    // fixture, which is what makes this assertable.
    const engine = OnePieceTestEngine.create(southHand(11), {});
    const shanksId = engine.findCardInZone("south", "hand", op09Shanks004);

    engine.playCard(op16BennBeckman012, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // The checks are printed after the cost, so the DON!! is spent whether or not they hold --
    // this is what distinguishes an action-level condition from a block-level one.
    expect(engine.getView("south").players.south.restedDon).toBe(op16BennBeckman012.cost + 1);
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[shanksId]?.zone).toBe("hand");
  });

  test("9 DON!! on the field does not satisfy it either", () => {
    const engine = OnePieceTestEngine.create(southHand(9), {});
    const shanksId = engine.findCardInZone("south", "hand", op09Shanks004);

    engine.playCard(op16BennBeckman012, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[shanksId]?.zone).toBe("hand");
  });

  test("a Leader without the [Red-Haired Pirates] type plays nothing, even at 10 DON!!", () => {
    const engine = OnePieceTestEngine.create(
      { ...southHand(10), leaderCardId: op13MonkeyDLuffy001 },
      {},
    );
    const shanksId = engine.findCardInZone("south", "hand", op09Shanks004);

    engine.playCard(op16BennBeckman012, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[shanksId]?.zone).toBe("hand");
  });

  test("[Blocker] offers this Character as a block target on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op09Shanks001, character: [op16BennBeckman012] },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ATTACKS,
    );
    const beckmanId = engine.findCardInZone("south", "character", op16BennBeckman012);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, engine.leader("south"), "north");
    // The Shanks Leader's own [On Your Opponent's Attack] ability queues ahead of the blocker
    // step; decline it so this test is only about Benn.Beckman's printed [Blocker].
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const block = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (block?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(block.candidates.map((candidate) => candidate.ref.id)).toContain(beckmanId);
  });
});
