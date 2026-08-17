import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Atmos003,
  op02Blugori084,
  op02LittleoarsJr020,
  op03Namule007,
  op16MissOlive050,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-050 Miss Olive", () => {
  test("ruling #992: Miss Olive may pay by returning HERSELF, then draws 2 and trashes 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        // op01Sai012 (cost 2) sits exactly on the "cost of 2 or more" line; op02Blugori084
        // (cost 1) is the body that must be excluded. Below-the-line fixtures prove a filter
        // exists, on-the-line ones prove its number -- and `value: 2` is a single digit, so
        // mutation_check.py never perturbs it.
        character: [op02Blugori084, op01Sai012],
        hand: [op16MissOlive050, op03Namule007],
        deck: [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003],
        activeDon: 5,
      },
      {},
    );
    const blugoriId = engine.findCardInZone("south", "character", op02Blugori084);
    const saiId = engine.findCardInZone("south", "character", op01Sai012);
    const keptId = engine.findCardInZone("south", "hand", op03Namule007);
    const firstDrawId = engine.findCardInZone("south", "deck", op02Atmos003);

    engine.playCard(op16MissOlive050, "south");
    const oliveId = engine.findCardInZone("south", "character", op16MissOlive050);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostReturnCharacter", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Miss Olive's return-a-Character cost.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [saiId, oliveId].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(blugoriId);
    engine.resolveDecision("effectCostReturnCharacter", { selectedIds: [oliveId] }, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected the mandatory post-draw trash.");
    // Hand at this point: the kept Namule, the returned Miss Olive, and the 2 fresh draws.
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toContain(oliveId);
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toContain(firstDrawId);
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [firstDrawId] }, "south");

    const view = engine.getView("south");
    // 1 kept + Miss Olive back from the field + 2 drawn - 1 trashed = 3.
    expect(view.players.south.hand).toHaveLength(3);
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([keptId, oliveId]),
    );
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(firstDrawId);
    expect(view.players.south.characters.some((card) => card?.instanceId === oliveId)).toBe(false);
    expect(view.prompts).toHaveLength(0);
  });

  test("[On Play] is optional: declining draws nothing and returns nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [op01Sai012],
        hand: [op16MissOlive050, op03Namule007],
        deck: [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003],
        activeDon: 5,
      },
      {},
    );
    const saiId = engine.findCardInZone("south", "character", op01Sai012);

    engine.playCard(op16MissOlive050, "south");
    const handAfterPlay = engine.getState().players.south.hand.length;
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(handAfterPlay);
    expect(view.players.south.characters.some((card) => card?.instanceId === saiId)).toBe(true);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Blocker] redirects an attack away from the Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { character: [op16MissOlive050] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const oliveId = engine.findCardInZone("north", "character", op16MissOlive050);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Miss Olive's Blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(oliveId);
    engine.resolveDecision("battleBlocker", { selectedIds: [oliveId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(oliveId);
    expect(view.players.north.lifeCount).toBe(lifeBefore);
  });
});
