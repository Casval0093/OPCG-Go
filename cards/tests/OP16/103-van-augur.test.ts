import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op01Sai012,
  op02Kingdew006,
  op03Namule007,
  op09MarshallDTeach081,
  op16VanAugur103,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #1011's scenario is "my Leader takes damage on MY turn and this [Trigger] fires". Nothing
// in the printed card pool damages its own controller, so a minimal synthetic does it: `dealDamage`
// with `player: "self"` runs the same effect-damage path a real card would, including the Life
// reveal and the lifeTrigger prompt.
//
// It has to be an [Activate: Main], NOT an [On Play]: this test needs a [Blackbeard Pirates]
// Leader, and the only one in the engine (op09MarshallDTeach081) prints "Your [On Play] effects are
// negated." An onPlay synthetic under that Leader does nothing at all, silently -- no prompt, no
// capability issue, no log.
const selfDamage: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP16-103-SELF-DAMAGE",
  canonicalId: "TEST-OP16-103-SELF-DAMAGE",
  name: "Test Self Damage",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "activateMain",
        actions: [{ action: "dealDamage", player: "self", amount: 1 }],
      },
    ],
  },
};

registerCards([selfDamage]);

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-103 Van Augur", () => {
  test("[Opponent's Turn] [On K.O.] draws 1 and the -3000 is big enough to save the next defender", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          // 5000 power. Debuffed by -3000 it is 2000, which is short of the 3000-power body it
          // attacks next; at -2000 it would be 3000 and the attack would connect. That is what
          // pins the magnitude -- a thisTurn modifier cannot be read back off the projection.
          { card: op03Namule007, playedOnTurn: 0 },
          { card: op01Sai012, playedOnTurn: 0 },
        ],
      },
      {
        leaderCardId: op09MarshallDTeach081,
        character: [
          { card: op16VanAugur103, rested: true },
          { card: eb01Doma005, rested: true },
        ],
      },
      SOUTH_ATTACKS,
    );
    const debuffTargetId = engine.findCardInZone("south", "character", op03Namule007);
    const koAttackerId = engine.findCardInZone("south", "character", op01Sai012);
    const vanAugurId = engine.findCardInZone("north", "character", op16VanAugur103);
    const survivorId = engine.findCardInZone("north", "character", eb01Doma005);

    engine.declareAttack(koAttackerId, vanAugurId, "south");

    expect(engine.getState().cards[vanAugurId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(1);

    const choice = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(choice?.kind).toBe("selectEntity");
    if (choice?.kind !== "selectEntity") throw new Error("Expected Van Augur's debuff choice.");
    // "your opponent's Leader or Character cards" -- both zones, and only south's side.
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("south"), debuffTargetId, koAttackerId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(survivorId);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      engine.leader("north"),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [debuffTargetId] }, "north");

    engine.declareAttack(debuffTargetId, survivorId, "south");
    // North drew a card off the [On K.O.], so the counter step is offered this time.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    expect(engine.getState().cards[survivorId]?.zone).toBe("character");
  });

  test("[On K.O.] does nothing without a [Blackbeard Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op01Sai012, playedOnTurn: 0 }] },
      { character: [{ card: op16VanAugur103, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op01Sai012);
    const vanAugurId = engine.findCardInZone("north", "character", op16VanAugur103);

    engine.declareAttack(attackerId, vanAugurId, "south");

    expect(engine.getState().cards[vanAugurId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(0);
    expect(pendingIntents(engine)).toEqual([]);
  });

  test("[Trigger] on the opponent's turn does activate the [On K.O.]", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        life: [op16VanAugur103, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const vanAugurId = engine.findCardInZone("north", "life", op16VanAugur103);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "north",
    );
    expect(engine.getState().cards[vanAugurId]?.zone).toBe("trash");
  });

  test("ruling #1011: the [Trigger] fired on your OWN turn does not activate the [On K.O.]", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op09MarshallDTeach081,
        life: [op16VanAugur103, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
        hand: [op01Sai012],
        character: [{ card: selfDamage, playedOnTurn: 0 }],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const vanAugurId = engine.findCardInZone("south", "life", op16VanAugur103);
    const damageSourceId = engine.findCardInZone("south", "character", selfDamage);

    engine.activateEffect(damageSourceId, "activateMain", "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    // The [Opponent's Turn] qualifier still applies to the [On K.O.] reached through the
    // [Trigger]: no draw, no debuff prompt, and the card simply lands in the trash.
    expect(engine.getView("south").players.south.hand.map((card) => card.instanceId)).toEqual([
      engine.findCardInZone("south", "hand", op01Sai012),
    ]);
    expect(pendingIntents(engine)).toEqual([]);
    expect(engine.getState().cards[vanAugurId]?.zone).toBe("trash");
  });
});
