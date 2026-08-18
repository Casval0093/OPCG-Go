import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02Smoker093,
  op03Namule007,
  op05Enel098,
  op15Kuro025,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the printed [Blocker] keyword is encoded on this card -- both halves of its [On Play] are
// parked (see the card file: `giveDonSourcePlayer` for the opponent-sourced DON!! transfer, and
// `attachedDonTargetFilter` for the "3 or more DON!! cards given" freeze). So this file covers the
// keyword, and there is deliberately nothing here about the [On Play].
describe("OP15-025 Kuro", () => {
  test("the printed [Blocker] works, and an identically-active vanilla body next to it does not", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [{ card: op15Kuro025 }, { card: op03Namule007 }] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const kuroId = engine.findCardInZone("south", "character", op15Kuro025);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a blocker selection.");
    const candidates = blocker.candidates
      .map((candidate) => candidate.ref.id)
      .filter((id) => id !== "skip");
    expect(candidates).toEqual([kuroId]);
    expect(candidates).not.toContain(namuleId);

    // Blocking redirects the attack onto Kuro and rests it -- the durable outcome, rather than
    // just the candidate list.
    engine.resolveDecision("battleBlocker", { selectedIds: [kuroId] }, "south");
    const state = engine.getState();
    expect(state.cards[kuroId]?.rested).toBe(true);
    expect(state.players.south.life).toHaveLength(4);
  });
});
