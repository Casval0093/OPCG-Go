import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Kingdew006,
  op03Genzo046,
  op15Brook022,
  op15Krieg001,
  op15SwallowBondEnAvant096,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15SwallowBondEnAvant096;
const DECK = Array.from({ length: 8 }, () => op03Genzo046);

describe("OP15-096 Swallow Bond en Avant", () => {
  test("[Main] rests 1 DON!! and mills 5 for a [Straw Hat Crew] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Brook022, hand: [CARD], activeDon: 1, deck: DECK },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.deckCount).toBe(3);
    // The Event itself is in the trash too, so 5 milled + 1 = 6.
    expect(view.players.south.trash).toHaveLength(6);
    expect(view.players.south.restedDon).toBe(1);
  });

  test("[Main] does nothing for a Leader without the [Straw Hat Crew] type", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, hand: [CARD], activeDon: 1, deck: DECK },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").players.south.deckCount).toBe(8);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[Counter] gives exactly +3000 -- enough to survive a 7000 attacker, which +2000 would not be", () => {
    // The MAGNITUDE, not just the target: asserting a candidate list leaves `value` free. The
    // attacker is pitched at exactly the defender's power + the NEXT-LOWER value, so the real value
    // and a mutated one give opposite outcomes (`attackPower >= defensePower` is a hit).
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { leaderCardId: op15Krieg001, hand: [CARD, op03Genzo046], activeDon: 1 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const counterId = engine.findCardInZone("north", "hand", CARD);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    // Kingdew 7000 vs the Leader at 5000 + 3000 = 8000.
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });

  test("[Counter] trashes 1 card from hand to give +3000, with no Leader-type requirement", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op03Genzo046, playedOnTurn: 0 }] },
      // Krieg Leader on the defending side proves the [Counter] half carries no trait condition.
      { leaderCardId: op15Krieg001, hand: [CARD, op03Genzo046, op02Atmos003], activeDon: 1 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op03Genzo046);
    const counterId = engine.findCardInZone("north", "hand", CARD);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [engine.findCardInZone("north", "hand", op03Genzo046)] },
      "north",
    );
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    // Started with 3, played the Counter, trashed 1 -> 1 left.
    expect(engine.getView("north").players.north.hand).toHaveLength(1);
  });
});
