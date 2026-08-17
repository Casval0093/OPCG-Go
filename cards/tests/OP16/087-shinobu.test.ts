import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02KinEmon025,
  op10KouzukiMomonosuke083,
  op12KinEmon025,
  op16KouzukiMomonosuke084,
  op16Shinobu087,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-087 Shinobu", () => {
  test("gives exactly +20 cost to one of your OWN [Kouzuki Momonosuke], nobody else's and nothing else", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02KinEmon025,
        hand: [op16Shinobu087],
        deck: [eb01Doma005, eb01Doma005],
        // op12KinEmon025 is Land of Wano too, and is what proves the filter is on the NAME
        // rather than on the trait shared by everything else in this deck.
        character: [op16KouzukiMomonosuke084, op12KinEmon025],
        activeDon: op16Shinobu087.cost,
      },
      // An opponent-controlled Kouzuki Momonosuke: right name, wrong controller. Proves
      // `player: "self"`.
      { character: [op10KouzukiMomonosuke083] },
    );
    const momonosukeId = engine.findCardInZone("south", "character", op16KouzukiMomonosuke084);
    const wrongNameId = engine.findCardInZone("south", "character", op12KinEmon025);
    const opponentMomonosukeId = engine.findCardInZone(
      "north",
      "character",
      op10KouzukiMomonosuke083,
    );

    engine.playCard(op16Shinobu087, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Shinobu's cost target.");
    const ids = selection.candidates.map((candidate) => candidate.ref.id);
    expect(ids).toEqual([momonosukeId]);
    expect(ids).not.toContain(wrongNameId);
    expect(ids).not.toContain(opponentMomonosukeId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [momonosukeId] }, "south");

    let view = engine.getView("south");
    // 5 + 20. Pins the magnitude, which is the number OP16-084's own cost-20 gate depends on.
    expect(
      view.players.south.characters.find((card) => card?.instanceId === momonosukeId)?.cost,
    ).toBe(25);
    // The cost was paid and the draw happened.
    expect(view.players.south.characters.map((card) => card?.instanceId)).not.toContain(
      engine.findCardInZone("south", "trash", op16Shinobu087),
    );
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.deckCount).toBe(1);

    engine.endTurn("south");
    view = engine.getView("north");
    expect(
      view.players.south.characters.find((card) => card?.instanceId === momonosukeId)?.cost,
    ).toBe(5);
  });

  test("ruling #1005: with no [Kouzuki Momonosuke] at all, the cost is still payable and the draw still happens", () => {
    const engine = OnePieceTestEngine.create({
      leaderCardId: op02KinEmon025,
      hand: [op16Shinobu087],
      deck: [eb01Doma005, eb01Doma005],
      activeDon: op16Shinobu087.cost,
    });

    engine.playCard(op16Shinobu087, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    // 可以. An `upTo` target with zero legal candidates publishes no prompt and nothing happens
    // (GENERAL ruling #27); the draw in front of it is unaffected. Gating the whole block on
    // having a Momonosuke would get this ruling backwards.
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.deckCount).toBe(1);
    expect(view.players.south.trash.map((card) => card.cardId)).toEqual([op16Shinobu087.id]);
    expect(view.players.south.characters.filter(Boolean)).toHaveLength(0);
  });

  test("without a [Land of Wano] Leader nothing happens and Shinobu stays on the field", () => {
    const engine = OnePieceTestEngine.create({
      // Default Leader OP13-001: "Straw Hat Crew Supernovas", no Land of Wano.
      hand: [op16Shinobu087],
      deck: [eb01Doma005, eb01Doma005],
      character: [op16KouzukiMomonosuke084],
      activeDon: op16Shinobu087.cost,
    });
    const momonosukeId = engine.findCardInZone("south", "character", op16KouzukiMomonosuke084);

    engine.playCard(op16Shinobu087, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.characters.map((card) => card?.instanceId)).toContain(
      engine.findCardInZone("south", "character", op16Shinobu087),
    );
    expect(view.players.south.deckCount).toBe(2);
    expect(
      view.players.south.characters.find((card) => card?.instanceId === momonosukeId)?.cost,
    ).toBe(5);
  });
});
