import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Kingdew006,
  op03Namule007,
  op05Enel098,
  op15Conis104,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function conisOnPlay(southLife: number, northLife: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op05Enel098,
      hand: [op15Conis104, op01Sai012, op03Namule007],
      life: southLife,
      deck: 20,
      activeDon: 1,
    },
    { life: northLife },
    SOUTH_ACTS,
  );
}

describe("OP15-104 Conis", () => {
  test("[On Play] draws 2 and trashes 2 when you are behind on Life", () => {
    const engine = conisOnPlay(2, 4);

    engine.playCard(op15Conis104, "south");
    // 2 in hand after playing Conis, +2 drawn = 4, then 2 are trashed.
    expect(engine.getState().players.south.hand).toHaveLength(4);

    const selection = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a trash selection.");
    expect(selection.max).toBe(2);
    const hand = [...engine.getState().players.south.hand];
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: hand.slice(0, 2) },
      "south",
    );

    expect(engine.getState().players.south.hand).toHaveLength(2);
    expect(engine.getState().players.south.trash).toHaveLength(2);
  });

  test("equal Life counts do NOT satisfy it -- the comparison is strict", () => {
    const engine = conisOnPlay(3, 3);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15Conis104, "south");

    // `lifeComparison` with `selfComparison: "lt"`: at 3 vs 3 nothing fires, so no prompt and no
    // net hand change beyond the card that was played.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toHaveLength(handBefore - 1);
  });

  test("being ahead on Life does not satisfy it either", () => {
    const engine = conisOnPlay(5, 2);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15Conis104, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toHaveLength(handBefore - 1);
  });

  test("the printed [Trigger] is its own block -- draw 2, trash ONE, no Life comparison", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }], life: 5 },
      // North is AHEAD on Life (5 vs 5 south, and the [On Play] would not fire at parity anyway),
      // which is what shows the [Trigger] half carries no `lifeComparison` of its own.
      { life: [op15Conis104, op01Sai012, op01Sai012, op01Sai012, op01Sai012], deck: 20 },
      SOUTH_ACTS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const selection = engine.pendingDecision("effectTrashFromHandSelection", "north").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a trash selection.");
    // ONE, not two: the [Trigger] block's own number. `max` is the assertion that would go red if
    // the [On Play] block's `amount: 2` were copied across.
    expect(selection.max).toBe(1);
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [engine.getState().players.north.hand[0] ?? ""] },
      "north",
    );

    // Hand started empty: +2 drawn, -1 trashed.
    expect(engine.getState().players.north.hand).toHaveLength(1);
    expect(engine.getState().players.north.trash.length).toBeGreaterThanOrEqual(2);
  });
});
