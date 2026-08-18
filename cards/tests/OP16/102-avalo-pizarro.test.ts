import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Kingdew006,
  op02MobyDick024,
  op09Fullalead099,
  op16AvaloPizarro102,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

describe("OP16-102 Avalo Pizarro", () => {
  test("[On K.O.] draws 1 and plays [Fullalead] from either the hand or the trash", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op01Sai012, playedOnTurn: 0 }] },
      {
        character: [{ card: op16AvaloPizarro102, rested: true }],
        // One copy in each source zone, so `zone: ["hand", "trash"]` is proven to reach both.
        hand: [op09Fullalead099, op02MobyDick024],
        trash: [op09Fullalead099],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op01Sai012);
    const avaloId = engine.findCardInZone("north", "character", op16AvaloPizarro102);
    const fromHandId = engine.findCardInZone("north", "hand", op09Fullalead099);
    const fromTrashId = engine.findCardInZone("north", "trash", op09Fullalead099);
    // A different Stage, so the `name` filter has something real to exclude. A Character or an
    // Event would not do the job: an Event never reaches a `play` action's candidate pool at all.
    const wrongNameId = engine.findCardInZone("north", "hand", op02MobyDick024);

    engine.declareAttack(attackerId, avaloId, "south");
    // North holds cards, so the counter step is offered before damage/effects resolve.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    // 2 held + 1 drawn.
    expect(engine.getView("north").players.north.hand).toHaveLength(3);

    const play = engine.pendingDecision("effectPlaySelection", "north").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Avalo Pizarro's play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [fromHandId, fromTrashId].sort(),
    );
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongNameId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [fromTrashId] }, "north");

    expect(engine.getState().players.north.stageArea).toBe(fromTrashId);
    expect(engine.getState().cards[fromHandId]?.zone).toBe("hand");
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        life: [op16AvaloPizarro102, op01Sai012, op01Sai012, op01Sai012],
        trash: [op09Fullalead099],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const avaloId = engine.findCardInZone("north", "life", op16AvaloPizarro102);
    const fromTrashId = engine.findCardInZone("north", "trash", op09Fullalead099);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [fromTrashId] }, "north");

    expect(engine.getState().players.north.stageArea).toBe(fromTrashId);
    expect(engine.getState().cards[avaloId]?.zone).toBe("trash");
  });
});
