import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01MountainGod018,
  op03Alvida023,
  op03Jerry084,
  op16TonyTonyChopper090,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-090 Tony Tony.Chopper", () => {
  test("draws 2, trashes the chosen 2, then K.O.s only an opposing Character at cost 1 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16TonyTonyChopper090, eb01Doma005],
        deck: [eb01Fourtricks025, eb01MountainGod018, eb01Doma005],
        // Our own cost-1 Character. Nothing else in this file notices if `player` is not
        // "opponent", and K.O.ing your own board is the failure mode that matters.
        character: [op03Alvida023],
        activeDon: op16TonyTonyChopper090.cost,
      },
      {
        // op03Alvida023 is cost 1 -- exactly on the printed line, which is what pins the
        // threshold. op03Jerry084 is cost 2, one step over: included by a `gte 1` misreading
        // and by a deleted cost filter.
        character: [op03Alvida023, op03Jerry084],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const firstDrawId = engine.findCardInZone("south", "deck", eb01Fourtricks025);
    const secondDrawId = engine.findCardInZone("south", "deck", eb01MountainGod018);
    const ownCheapId = engine.findCardInZone("south", "character", op03Alvida023);
    const targetId = engine.findCardInZone("north", "character", op03Alvida023);
    const tooExpensiveId = engine.findCardInZone("north", "character", op03Jerry084);

    engine.playCard(op16TonyTonyChopper090, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Chopper's hand-trash choice.");
    expect(trash).toMatchObject({ min: 2, max: 2 });
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [firstDrawId, secondDrawId] },
      "south",
    );

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected Chopper's K.O. target.");
    expect(ko).toMatchObject({ min: 0, max: 1 });
    const ids = ko.candidates.map((candidate) => candidate.ref.id);
    expect(ids).toEqual([targetId]);
    expect(ids).not.toContain(tooExpensiveId);
    expect(ids).not.toContain(ownCheapId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");

    const view = engine.getView("south");
    expect(view.players.north.trash.map((card) => card.instanceId)).toEqual([targetId]);
    expect(view.players.north.characters.map((card) => card?.instanceId)).toContain(tooExpensiveId);
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(ownCheapId);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([firstDrawId, secondDrawId]),
    );
    expect(view.prompts).toHaveLength(0);
  });

  test("may K.O. nothing, and the draw/trash still happened", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16TonyTonyChopper090, eb01Doma005],
        deck: [eb01Fourtricks025, eb01MountainGod018, eb01Doma005],
        activeDon: op16TonyTonyChopper090.cost,
      },
      { character: [op03Alvida023] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const targetId = engine.findCardInZone("north", "character", op03Alvida023);

    engine.playCard(op16TonyTonyChopper090, "south");
    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected Chopper's hand-trash choice.");
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: trash.candidates.slice(0, 2).map((candidate) => candidate.ref.id) },
      "south",
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.players.north.characters.map((card) => card?.instanceId)).toContain(targetId);
    expect(view.players.south.trash).toHaveLength(2);
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });
});
