import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op02Kingdew006, op15Genbo103 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// North defends with an empty hand throughout, so no battleCounter step opens before damage.
function genboOnTopOfLife(fillerCount: number) {
  const engine = OnePieceTestEngine.create(
    { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
    { life: [op15Genbo103, ...Array.from({ length: fillerCount }, () => op01Sai012)] },
    SOUTH_ATTACKS,
  );
  return engine;
}

describe("OP15-103 Genbo", () => {
  test("ruling #937: the [Trigger] plays it when Life is 3 INCLUDING this card", () => {
    const engine = genboOnTopOfLife(2);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const genboId = engine.findCardInZone("north", "life", op15Genbo103);
    const handBefore = engine.getState().players.north.hand.length;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // 可以. The card is already out of the Life area by the time its own [Trigger] resolves, so
    // the count the condition sees is 2 -- the printed number. Encoding 3 here would be wrong.
    const state = engine.getState();
    expect(state.players.north.life).toHaveLength(2);
    expect(state.cards[genboId]?.zone).toBe("character");
    // The draw is unconditional and happens on this branch too.
    expect(state.players.north.hand).toHaveLength(handBefore + 1);
  });

  test("the [Trigger] still draws but does NOT play it with Life well above the threshold", () => {
    // 5 Life -> 4 once this card leaves. 4 is clear of the line in a way 3 is not: at exactly 2
    // remaining, `lte 2` and `gte 2` both hold, so only a case like this separates them.
    const engine = genboOnTopOfLife(4);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const genboId = engine.findCardInZone("north", "life", op15Genbo103);
    const handBefore = engine.getState().players.north.hand.length;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const state = engine.getState();
    expect(state.players.north.life).toHaveLength(4);
    // Activating a [Trigger] consumes the card to the trash; it does not also join the hand
    // (GENERAL ruling #21), so the only card gained is the one the draw itself produced.
    expect(state.cards[genboId]?.zone).toBe("trash");
    expect(state.players.north.hand).toHaveLength(handBefore + 1);
    expect(state.players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });

  test("exactly on the line: 3 Life including this card leaves 2, and 2 still plays it", () => {
    // The boundary case for `lte 2` from the other side -- 4 Life becomes 3 remaining, one over.
    const engine = genboOnTopOfLife(3);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const genboId = engine.findCardInZone("north", "life", op15Genbo103);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getState().players.north.life).toHaveLength(3);
    expect(engine.getState().cards[genboId]?.zone).toBe("trash");
  });

  test("declining the [Trigger] adds the card to hand instead and never draws", () => {
    const engine = genboOnTopOfLife(2);
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const genboId = engine.findCardInZone("north", "life", op15Genbo103);
    const handBefore = engine.getState().players.north.hand.length;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "skip" }, "north");

    const state = engine.getState();
    expect(state.cards[genboId]?.zone).toBe("hand");
    expect(state.players.north.hand).toHaveLength(handBefore + 1);
    expect(state.players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });
});
