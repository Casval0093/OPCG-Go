import { describe, expect, test } from "vite-plus/test";
import {
  eb01Kyros040,
  op01Bellamy076,
  op02Smoker093,
  op02Thatch007,
  op04Rebecca039,
  op15Kyros042,
} from "@tcg/op-cards";

import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op04Rebecca039 -- a Leader NAMED Rebecca.
// eb01Kyros040   -- also a [Dressrosa] Leader, also inert, but named Kyros. That is deliberately
//                   the only difference between the two boards: a wrong-name fixture has to be
//                   right about everything else, or it exercises some other filter.
function kyrosUnder(leaderCardId: CardRef) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op15Kyros042, op01Bellamy076], activeDon: 3 },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-042 Kyros", () => {
  test("[On Play] under a [Rebecca] Leader: trash 1 card, gain [Rush], attack the same turn", () => {
    const engine = kyrosUnder(op04Rebecca039);
    const fodderId = engine.findCardInZone("south", "hand", op01Bellamy076);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op15Kyros042, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    // One eligible card left in hand, so the cost auto-pays with no prompt.
    const kyrosId = engine.findCardInZone("south", "character", op15Kyros042);
    expect(engine.getState().players.south.trash).toContain(fodderId);

    engine.declareAttack(kyrosId, engine.leader("north"), "south");
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("under a non-[Rebecca] Leader the cost is still payable and buys NOTHING", () => {
    // The [Rebecca] check sits after the cost colon, so it gates the payload only. Move it up to
    // the block's `conditions` and the trash below stops happening, turning this red.
    const engine = kyrosUnder(eb01Kyros040);
    const fodderId = engine.findCardInZone("south", "hand", op01Bellamy076);

    engine.playCard(op15Kyros042, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    const kyrosId = engine.findCardInZone("south", "character", op15Kyros042);

    expect(engine.getState().players.south.trash).toContain(fodderId);
    const rejection = engine.expectFailure({
      type: "declareAttack",
      seat: "south",
      attackerId: kyrosId,
      targetId: engine.leader("north"),
    });
    expect(rejection.reason).toBe("The selected attacker cannot attack.");
  });

  test('"You may" is a real choice -- declining trashes nothing and grants nothing', () => {
    const engine = kyrosUnder(op04Rebecca039);
    const fodderId = engine.findCardInZone("south", "hand", op01Bellamy076);

    engine.playCard(op15Kyros042, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");
    const kyrosId = engine.findCardInZone("south", "character", op15Kyros042);

    expect(engine.getState().players.south.hand).toContain(fodderId);
    expect(engine.getState().players.south.trash).toHaveLength(0);
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: kyrosId,
        targetId: engine.leader("north"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
  });

  test("[On K.O.] this card comes back from the trash to hand", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op04Rebecca039, character: [{ card: op15Kyros042, rested: true }] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const kyrosId = engine.findCardInZone("south", "character", op15Kyros042);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, kyrosId, "north");

    const state = engine.getState();
    // It passes THROUGH the trash -- the `onKo` block resolves after the K.O. has moved it there,
    // which is what "from your trash" means -- and ends in hand, not in the trash.
    expect(state.cards[kyrosId]?.zone).toBe("hand");
    expect(state.players.south.trash).not.toContain(kyrosId);
    expect(state.players.south.hand).toContain(kyrosId);
  });
});
