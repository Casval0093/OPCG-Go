import { describe, expect, test } from "vite-plus/test";
import {
  eb02Yamato006,
  op02Yamato042,
  op03Nero087,
  op04Ideo077,
  op04Yamato112,
  op12Issho082,
  op16Yamato096,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-096 Yamato", () => {
  test("printed [Unblockable] skips the blocker step entirely", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Yamato096, playedOnTurn: 0 }] },
      { character: [op04Ideo077] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const yamatoId = engine.findCardInZone("south", "character", op16Yamato096);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(yamatoId, engine.leader("north"), "south");

    // op04Ideo077 is an active [Blocker] and would otherwise get a prompt here (see the control
    // test in cards/tests/OP16/095-monkey-d-luffy.test.ts, same fixture). This is the first card
    // in the engine to carry [Unblockable] as a printed keyword rather than a granted one.
    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("[On K.O.] plays only a [Yamato] at cost 6 or less out of the trash", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        character: [{ card: op16Yamato096, rested: true, playedOnTurn: 0 }],
        trash: [
          // Eligible: cost 4, and cost 6 exactly on the printed line.
          op02Yamato042,
          eb02Yamato006,
          // A cost-9 Yamato: excluded by the cost filter, and the body that separates `lte 6`
          // from `gte 6`.
          op04Yamato112,
          // Cost 3, but not named Yamato.
          op03Nero087,
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op12Issho082);
    const yamatoId = engine.findCardInZone("north", "character", op16Yamato096);
    const eligibleIds = [
      engine.findCardInZone("north", "trash", op02Yamato042),
      engine.findCardInZone("north", "trash", eb02Yamato006),
    ];
    const overCostId = engine.findCardInZone("north", "trash", op04Yamato112);
    const wrongNameId = engine.findCardInZone("north", "trash", op03Nero087);

    // 10000 into Yamato's 8000.
    engine.declareAttack(attackerId, yamatoId, "south");

    const play = engine.pendingDecision("effectPlaySelection", "north").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Yamato's revival choice.");
    expect(play).toMatchObject({ min: 0, max: 1 });
    const ids = play.candidates.map((candidate) => candidate.ref.id);
    expect(ids.sort()).toEqual([...eligibleIds].sort());
    expect(ids).not.toContain(overCostId);
    expect(ids).not.toContain(wrongNameId);
    // The K.O.'d card is itself a cost-8 [Yamato] sitting in this same trash by now, so `lte 6`
    // is also what stops this card reviving itself.
    expect(ids).not.toContain(yamatoId);
    // eb02Yamato006 has no [On Play], so nothing cascades and the revival is directly observable.
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleIds[1]!] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.characters.map((card) => card?.instanceId)).toContain(eligibleIds[1]);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(yamatoId);
    expect(view.prompts).toHaveLength(0);
  });

  test("[On K.O.] may revive nothing", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        character: [{ card: op16Yamato096, rested: true, playedOnTurn: 0 }],
        trash: [op02Yamato042],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op12Issho082);
    const yamatoId = engine.findCardInZone("north", "character", op16Yamato096);
    const candidateId = engine.findCardInZone("north", "trash", op02Yamato042);

    engine.declareAttack(attackerId, yamatoId, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([candidateId, yamatoId]),
    );
    expect(view.players.north.characters.filter(Boolean)).toHaveLength(0);
    expect(view.prompts).toHaveLength(0);
  });
});
