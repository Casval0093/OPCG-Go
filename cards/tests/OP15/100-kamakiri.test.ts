import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02LittleoarsJr020,
  op05Enel098,
  op11XDrake017,
  op15Kamakiri100,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Both opponent bodies are vanilla and straddle the printed line:
//   op11XDrake017        cost 6 -- exactly on it, which is the only fixture that pins the number
//   op02LittleoarsJr020  cost 7 -- one clear of it
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function kamakiriBoard(life: number) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15Kamakiri100, op01Sai012], life, activeDon: 5 },
    {
      character: [
        { card: op11XDrake017, playedOnTurn: 0 },
        { card: op02LittleoarsJr020, playedOnTurn: 0 },
      ],
    },
    SOUTH_ACTS,
  );
}

describe("OP15-100 Kamakiri", () => {
  test("[On Play] trashes itself and banks a Life card to K.O. a cost-6-or-less Character", () => {
    const engine = kamakiriBoard(3);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);
    const oarsId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15Kamakiri100, "south");
    const kamakiriId = engine.findCardInZone("south", "character", op15Kamakiri100);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected a K.O. target selection.");
    // Exactly on the line is in, one over is out. A 4000-power body would satisfy `lte 5` too.
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([drakeId]);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [drakeId] }, "south");

    const state = engine.getState();
    expect(state.cards[drakeId]?.zone).toBe("trash");
    expect(state.cards[oarsId]?.zone).toBe("character");
    // Both halves of the cost really happened: the body is in the trash and the Life card is in
    // hand. `playCard` spent one card from hand, so hand is (before - 1 played + 1 from Life).
    expect(state.cards[kamakiriId]?.zone).toBe("trash");
    expect(state.players.south.life).toHaveLength(2);
    expect(state.players.south.hand).toHaveLength(handBefore);
  });

  test("ruling #935: declining leaves the Character on the field, the Life card in Life, and no K.O.", () => {
    const engine = kamakiriBoard(3);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);

    engine.playCard(op15Kamakiri100, "south");
    const kamakiriId = engine.findCardInZone("south", "character", op15Kamakiri100);
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    // 可以 -- and "这种情况下" all three consequences are skipped together, not just the K.O.
    const state = engine.getState();
    expect(state.cards[kamakiriId]?.zone).toBe("character");
    expect(state.players.south.life).toHaveLength(3);
    expect(state.cards[drakeId]?.zone).toBe("character");
  });

  test("ruling #936: at 0 Life cards the effect is never offered at all", () => {
    const engine = kamakiriBoard(0);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);

    engine.playCard(op15Kamakiri100, "south");
    const kamakiriId = engine.findCardInZone("south", "character", op15Kamakiri100);

    // `canPayCosts` runs before the confirm is created, so an unpayable optional block publishes
    // no prompt whatsoever -- 不可以, with nothing to decline.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[kamakiriId]?.zone).toBe("character");
    expect(engine.getState().cards[drakeId]?.zone).toBe("character");
  });
});
