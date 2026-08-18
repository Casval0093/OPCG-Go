import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op03Namule007,
  op15Krieg001,
  op15Mamaragan078,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15Mamaragan078;

describe("OP15-078 Mamaragan", () => {
  test("[Main] costs DON!! -2 (not -1), draws 1, and rests an opponent Character at 5000 power or less", () => {
    const engine = OnePieceTestEngine.create(
      // No [Enel] condition on this card either -- an unrelated Leader is fine (ruling #917's quoted
      // text carries none).
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 2,
        deck: [op03Genzo046, op02Atmos003],
      },
      // Namule sits EXACTLY on the 5000 threshold, which is what pins `value: 5000` -- with only a
      // 3000 body here, mutating the threshold down to 4000 changes nothing and the mutant survives.
      { character: [op03Namule007, op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const merryId = engine.findCardInZone("north", "character", op03Namule007);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(CARD, "south");

    const rest = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(rest?.kind).toBe("selectEntity");
    if (rest?.kind !== "selectEntity") throw new Error("Expected Mamaragan's rest target.");
    // Namule is exactly 5000 and qualifies; Atmos 6000 does not.
    expect(rest.candidates.map((candidate) => candidate.ref.id)).toEqual([merryId]);
    expect(rest.candidates.map((candidate) => candidate.ref.id)).not.toContain(atmosId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [merryId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.activeDon).toBe(0);
    expect(
      engine.getView("north").players.north.characters.find((card) => card?.instanceId === merryId)
        ?.rested,
    ).toBe(true);
  });

  test("[Counter] gives exactly +1000 -- enough to survive a 5000 attacker, which +0 would not be", () => {
    // Pins the [Counter]'s `value`. Namule attacks at 5000 into a 5000 Leader: at +1000 the Leader is
    // 6000 and holds, at +0 `attackPower >= defensePower` connects.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Namule007, playedOnTurn: 0 }] },
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 4,
        deck: [op03Genzo046, op02Atmos003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Namule007);
    const counterId = engine.findCardInZone("north", "hand", CARD);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });

  test("1 DON!! is not enough to pay the DON!! -2 cost", () => {
    // Pins `amount: 2`. At `amount: 1` this play would succeed and the test goes red.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      { character: [op03Namule007] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    // The Event resolves but its cost cannot be paid, so nothing happens.
    expect(engine.getView("south").players.south.hand).toHaveLength(0);
    expect(engine.getView("south").players.south.activeDon).toBe(1);
  });

  test("[Counter] boosts +1000 and then draws only while you have 6 or fewer DON!! on the field", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 4,
        deck: [op03Genzo046, op02Atmos003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    // 4 DON!! on field is within "6 or less", so the conditional draw fires.
    expect(engine.getView("north").players.north.hand).toHaveLength(1);
  });

  test("[Counter] at 10 DON!! on the field boosts but does NOT draw", () => {
    // The conditional on the second action is load-bearing: remove it and this goes red with a card
    // in hand.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 10,
        deck: [op03Genzo046, op02Atmos003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    expect(engine.getView("north").players.north.hand).toHaveLength(0);
  });
});
