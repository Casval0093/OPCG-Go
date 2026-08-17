import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op16PortgasDAce049 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-049 Portgas.D.Ace", () => {
  test("resting this Character draws exactly 1 card", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16PortgasDAce049, playedOnTurn: 0 }],
        deck: [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003],
      },
      {},
    );
    const aceId = engine.findCardInZone("south", "character", op16PortgasDAce049);
    const topId = engine.findCardInZone("south", "deck", op02Atmos003);
    const handBefore = engine.getState().players.south.hand.length;

    engine.activateEffect(aceId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(topId);
    expect(view.players.south.hand).toHaveLength(handBefore + 1);
    expect(view.players.south.characters.find((card) => card?.instanceId === aceId)?.rested).toBe(
      true,
    );
    expect(view.prompts).toHaveLength(0);
  });

  test("declining draws nothing and leaves this Character active", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16PortgasDAce049, playedOnTurn: 0 }] },
      {},
    );
    const aceId = engine.findCardInZone("south", "character", op16PortgasDAce049);
    const handBefore = engine.getState().players.south.hand.length;

    engine.activateEffect(aceId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(handBefore);
    expect(view.players.south.characters.find((card) => card?.instanceId === aceId)?.rested).toBe(
      false,
    );
  });

  test("an already-rested copy cannot pay its own cost", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16PortgasDAce049, playedOnTurn: 0, rested: true }] },
      {},
    );
    const aceId = engine.findCardInZone("south", "character", op16PortgasDAce049);

    // `restThisCard` is the whole cost; there is no separate condition to fail, so this is the
    // only observable difference between "has a cost" and "is free".
    const result = engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: aceId,
      trigger: "activateMain",
    });
    expect(result.reason).toBe("The activation costs cannot be paid.");
  });
});
