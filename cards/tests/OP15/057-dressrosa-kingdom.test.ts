import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op04ColorsTrap074,
  op04Spiderweb035,
  op15DressrosaKingdom057,
  op15Krieg001,
  op15Rebecca039,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15DressrosaKingdom057;

describe("OP15-057 Dressrosa Kingdom", () => {
  test("[On Play] draws 1 for a [Dressrosa] Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Rebecca039,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(1);
    expect(engine.findCardInZone("south", "stage", CARD)).toBeTruthy();
  });

  test("[On Play] draws nothing for a Leader without the [Dressrosa] type", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(0);
  });

  test("[On Your Opponent's Attack] rests the Stage and trashes an Event to give +2000", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Rebecca039,
        stage: CARD,
        // TWO Events, so the cost publishes a real selection prompt -- with a single eligible card it
        // auto-pays and the filter would go untested. The Character must not be offered.
        hand: [op04Spiderweb035, op04ColorsTrap074, op03Genzo046],
      },
      // A 6000 attacker is what pins `value: 2000`: against a 5000 Leader, +2000 makes 7000 and holds,
      // while +1000 makes 6000 and `attackPower >= defensePower` still connects. A 5000 Leader attacker
      // could not tell the two apart, and the mutant survived until this was changed.
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const spiderwebId = engine.findCardInZone("south", "hand", op04Spiderweb035);
    const colorsTrapId = engine.findCardInZone("south", "hand", op04ColorsTrap074);
    const genzoId = engine.findCardInZone("south", "hand", op03Genzo046);

    const lifeBefore = engine.getView("south").players.south.lifeCount;
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      engine.leader("south"),
      "north",
    );
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected the Stage's trash cost.");
    expect(cost.candidates.map((candidate) => candidate.ref.id)).toEqual([
      spiderwebId,
      colorsTrapId,
    ]);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(genzoId);
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [spiderwebId] }, "south");

    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    // Close the Counter Step so the battle actually finalises -- otherwise the lifeCount assertion
    // below reads a mid-battle state and holds regardless of the boost's value.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.stage?.rested).toBe(true);
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.lifeCount).toBe(lifeBefore);
  });
});
