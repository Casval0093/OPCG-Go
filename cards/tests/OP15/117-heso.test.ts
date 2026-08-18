import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op12Wyper114,
  op15Enel058,
  op15Heso117,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15Heso117;

describe("OP15-117 Heso!!", () => {
  test("[Main] draws 1 and gives a rested DON!! to a [Sky Island] card of yours", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Enel058,
        hand: [CARD],
        activeDon: 1,
        restedDon: 1,
        deck: [op03Genzo046, op02Atmos003],
        character: [op12Wyper114, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const wyperId = engine.findCardInZone("south", "character", op12Wyper114);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);

    engine.playCard(CARD, "south");
    // "up to 1 rested DON!! card" is a count choice, so the amount is prompted before the recipient.
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const recipient = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(recipient?.kind).toBe("selectEntity");
    if (recipient?.kind !== "selectEntity") throw new Error("Expected Heso's DON!! recipient.");
    const candidateIds = recipient.candidates.map((candidate) => candidate.ref.id);
    // Enel's Leader and Wyper are both [Sky Island]; Atmos (Whitebeard Pirates) is not. Drop the trait
    // filter and Atmos joins the list, so this goes red.
    expect(candidateIds).toContain(engine.leader("south"));
    expect(candidateIds).toContain(wyperId);
    expect(candidateIds).not.toContain(atmosId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [wyperId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(1);
    // 1 rested DON!! from the fixture, plus the 1 active DON!! that paying this Event's cost rested,
    // minus the 1 handed to Wyper.
    expect(view.players.south.restedDon).toBe(1);
    expect(
      view.players.south.characters.find((card) => card?.instanceId === wyperId)?.attachedDon,
    ).toBe(1);
  });

  test("[Trigger] draws 2 only for a [Sky Island] Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Enel058,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: [op03Genzo046, op02Atmos003, op03Genzo046],
      },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(2);
  });

  test("[Trigger] draws nothing for a Leader without the [Sky Island] type", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: [op03Genzo046, op02Atmos003, op03Genzo046],
      },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(0);
  });
});
