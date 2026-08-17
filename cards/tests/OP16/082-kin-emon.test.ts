import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  op02KinEmon025,
  op03Jerry084,
  op03Nero087,
  op12KinEmon025,
  op16KinEmon082,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-082 Kin'emon", () => {
  test("costs the printed 4 from hand and is a cost-7 body once on the field", () => {
    const engine = OnePieceTestEngine.create({
      // The default Leader (OP13-001) has no [Land of Wano] type, so the [On Play] never fires
      // and this test sees the static clause in isolation.
      hand: [op16KinEmon082],
      deck: [eb01Doma005, eb01Fourtricks025],
      // Exactly the printed cost. If "+3 cost" applied while the card was still in hand this
      // play would be rejected for insufficient DON!!, which is the whole point of scoping the
      // permanent modifier's target to `zones: ["character"]`.
      activeDon: op16KinEmon082.cost,
    });

    engine.playCard(op16KinEmon082, "south");
    const kinEmonId = engine.findCardInZone("south", "character", op16KinEmon082);

    const view = engine.getView("south");
    expect(
      view.players.south.characters.find((card) => card?.instanceId === kinEmonId)?.cost,
    ).toBe(7);
    // The [On Play] is gated on the Leader's type: no search happened at all.
    expect(view.players.south.deckCount).toBe(2);
    expect(view.prompts).toHaveLength(0);
  });

  test("with a [Land of Wano] Leader, looks at 5, may keep only a Land of Wano card, and trashes the other 4", () => {
    const engine = OnePieceTestEngine.create({
      leaderCardId: op02KinEmon025,
      hand: [op16KinEmon082],
      deck: [
        // Top 5. op12KinEmon025 is the only [Land of Wano] card among them; the other four are
        // what a deleted trait filter would wrongly make revealable.
        op12KinEmon025,
        op03Nero087,
        eb01Doma005,
        eb01Fourtricks025,
        op03Jerry084,
        eb01Doma005,
      ],
      activeDon: op16KinEmon082.cost,
    });
    const eligibleId = engine.findCardInZone("south", "deck", op12KinEmon025);
    const wrongTraitId = engine.findCardInZone("south", "deck", op03Nero087);
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);
    const untouchedId = engine.getState().players.south.deck[5];

    engine.playCard(op16KinEmon082, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected Kin'emon's search choice.");
    expect(search).toMatchObject({ min: 0, max: 1 });
    // The prompt lists every looked-at card and marks legality per candidate, so the exclusion
    // has to be asserted through `legal`, not through absence from the list.
    expect(search.candidates.map((candidate) => candidate.ref.id)).toEqual(lookedIds);
    expect(search.candidates.find((candidate) => candidate.ref.id === eligibleId)?.legal).toBe(
      true,
    );
    expect(search.candidates.find((candidate) => candidate.ref.id === wrongTraitId)?.legal).toBe(
      false,
    );
    engine.resolveDecision("effectSearchSelection", { selectedIds: [eligibleId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([eligibleId]);
    // 5 looked at, 1 kept, 4 trashed -- which is what pins `lookCount: 5`.
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining(lookedIds.filter((id) => id !== eligibleId)),
    );
    expect(view.players.south.trash).toHaveLength(4);
    expect(view.players.south.deckCount).toBe(1);
    expect(engine.getState().players.south.deck).toEqual([untouchedId]);
    expect(view.prompts).toHaveLength(0);
  });

  test("may reveal nothing, trashing all 5", () => {
    const engine = OnePieceTestEngine.create({
      leaderCardId: op02KinEmon025,
      hand: [op16KinEmon082],
      deck: [op12KinEmon025, op03Nero087, eb01Doma005, eb01Fourtricks025, op03Jerry084],
      activeDon: op16KinEmon082.cost,
    });
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);

    engine.playCard(op16KinEmon082, "south");
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(0);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining(lookedIds),
    );
    expect(view.prompts).toHaveLength(0);
  });
});
