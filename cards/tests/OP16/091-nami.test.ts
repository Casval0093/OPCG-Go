import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  op02KinEmon025,
  op12KinEmon025,
  op16Nami091,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-091 Nami", () => {
  test("looks at 4 and may keep a Land of Wano card that is not another Nami", () => {
    const engine = OnePieceTestEngine.create({
      leaderCardId: op02KinEmon025,
      hand: [op16Nami091],
      deck: [
        // Top 4. Only op12KinEmon025 is legal.
        op12KinEmon025,
        // A second copy of Nami herself: [Land of Wano] type, so the trait filter passes her and
        // only `excludeName` keeps her out. Nothing else in this set is both Land of Wano and
        // named Nami, so this is the only fixture that can exercise that filter.
        op16Nami091,
        // Not Land of Wano at all.
        eb01Doma005,
        eb01Fourtricks025,
        eb01Doma005,
      ],
      activeDon: op16Nami091.cost,
    });
    const eligibleId = engine.findCardInZone("south", "deck", op12KinEmon025);
    const sameNameId = engine.findCardInZone("south", "deck", op16Nami091);
    const wrongTraitId = engine.findCardInZone("south", "deck", eb01Doma005);
    const lookedIds = engine.getState().players.south.deck.slice(0, 4);

    engine.playCard(op16Nami091, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Nami's search choice.");
    expect(search).toMatchObject({ min: 0, max: 1 });
    expect(search.candidates.map((candidate) => candidate.ref.id)).toEqual(lookedIds);
    expect(search.candidates.find((candidate) => candidate.ref.id === eligibleId)?.legal).toBe(
      true,
    );
    expect(search.candidates.find((candidate) => candidate.ref.id === sameNameId)?.legal).toBe(
      false,
    );
    expect(search.candidates.find((candidate) => candidate.ref.id === wrongTraitId)?.legal).toBe(
      false,
    );
    engine.resolveDecision("effectSearchSelection", { selectedIds: [eligibleId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([eligibleId]);
    // 4 looked at, 1 kept, 3 trashed -- which is what pins `lookCount: 4` rather than 5.
    expect(view.players.south.trash).toHaveLength(3);
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });

  test("without a [Land of Wano] Leader the deck is never looked at", () => {
    const engine = OnePieceTestEngine.create({
      // Default Leader OP13-001: "Straw Hat Crew Supernovas".
      hand: [op16Nami091],
      deck: [op12KinEmon025, eb01Doma005, eb01Fourtricks025, eb01Doma005],
      activeDon: op16Nami091.cost,
    });

    engine.playCard(op16Nami091, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.deckCount).toBe(4);
    expect(view.players.south.trash).toHaveLength(0);
    expect(view.players.south.hand).toHaveLength(0);
  });
});
