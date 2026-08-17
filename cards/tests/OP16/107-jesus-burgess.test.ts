import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02LittleoarsJr020,
  op14eb04Absalom100,
  op16JesusBurgess107,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-107 Jesus Burgess", () => {
  test("[On K.O.] returns the top of the opponent's Life to THEIR hand, with no [Trigger]", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }],
        // op14eb04Absalom100 carries a printed [Trigger]. Moving a Life card by effect must NOT
        // offer it (GENERAL ruling #33: a [Trigger] is only activatable on damage).
        life: [op14eb04Absalom100, op01Sai012, op01Sai012, op01Sai012],
      },
      { character: [{ card: op16JesusBurgess107, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const burgessId = engine.findCardInZone("north", "character", op16JesusBurgess107);
    const topOfLifeId = engine.findCardInZone("south", "life", op14eb04Absalom100);

    engine.declareAttack(attackerId, burgessId, "south");

    // Burgess's controller chooses how many to move; the card itself goes to its own owner's hand.
    engine.resolveDecision("effectRemoveFromLifeCount", { optionId: "1" }, "north");

    const state = engine.getState();
    expect(state.cards[topOfLifeId]?.zone).toBe("hand");
    expect(state.players.south.hand).toContain(topOfLifeId);
    expect(state.players.north.hand).not.toContain(topOfLifeId);
    expect(state.players.south.life).toHaveLength(3);
    expect(pendingIntents(engine)).not.toContain("lifeTrigger");
  });

  test("[On K.O.] can decline, leaving the opponent's Life alone", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }],
        life: [op14eb04Absalom100, op01Sai012, op01Sai012, op01Sai012],
      },
      { character: [{ card: op16JesusBurgess107, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const burgessId = engine.findCardInZone("north", "character", op16JesusBurgess107);
    const topOfLifeId = engine.findCardInZone("south", "life", op14eb04Absalom100);

    engine.declareAttack(attackerId, burgessId, "south");
    engine.resolveDecision("effectRemoveFromLifeCount", { optionId: "0" }, "north");

    expect(engine.getState().cards[topOfLifeId]?.zone).toBe("life");
    expect(engine.getState().players.south.life).toHaveLength(4);
  });

  test("[Trigger] plays this card by trashing 1 card from hand", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { life: [op16JesusBurgess107, op01Sai012, op01Sai012, op01Sai012], hand: [op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const burgessId = engine.findCardInZone("north", "life", op16JesusBurgess107);
    const discardId = engine.findCardInZone("north", "hand", op01Sai012);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    // North holds a card, so the counter step is offered before damage resolves.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");

    const state = engine.getState();
    expect(state.cards[burgessId]?.zone).toBe("character");
    expect(state.cards[discardId]?.zone).toBe("trash");
  });

  test("ruling #1012: with an empty hand the [Trigger] cannot play this card", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { life: [op16JesusBurgess107, op01Sai012, op01Sai012, op01Sai012], hand: [] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const burgessId = engine.findCardInZone("north", "life", op16JesusBurgess107);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // The discard is a real cost, so an unpayable cost means the optional block is never even
    // offered -- this would NOT hold if the discard were encoded as an action.
    expect(pendingIntents(engine)).not.toContain("effectOptional");
    expect(engine.getState().cards[burgessId]?.zone).toBe("trash");
    expect(engine.getState().players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });
});
