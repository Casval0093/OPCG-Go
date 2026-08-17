import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op02Blugori084,
  op03Namule007,
  op11Saldeath064,
  op16Hannyabal072,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op11Saldeath064's traits are ["Impel Down"]; op02Blugori084's are the older concatenated
// ["Animal Impel Down"], which only matches because the trait filter carries `match: "includes"`.
// op03Namule007, eb01Doma005 and op02Atmos003 are vanilla and carry neither.
// The default Leader (OP13-001) is not [Impel Down] and this card prints no Leader condition.
function hannyabalWith(deck: PlayerFixture["deck"]) {
  const engine = OnePieceTestEngine.create(
    { hand: [op16Hannyabal072], deck, activeDon: op16Hannyabal072.cost },
    {},
  );
  engine.playCard(op16Hannyabal072, "south");
  return engine;
}

describe("OP16-072 Hannyabal", () => {
  test("looks at 5, may keep 1 [Impel Down] card, and bottoms the other 4", () => {
    const engine = hannyabalWith([
      op03Namule007,
      op02Blugori084,
      eb01Doma005,
      op11Saldeath064,
      op02Atmos003,
      // A 6th card the look must never reach.
      op03Namule007,
    ]);
    const [namuleId, blugoriId, domaId, saldeathId, atmosId, sixthId] = engine.getState().players
      .south.deck as [string, string, string, string, string, string];

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Hannyabal's look-at-5.");
    expect(look).toMatchObject({ min: 0, max: 1 });
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      namuleId,
      blugoriId,
      domaId,
      saldeathId,
      atmosId,
    ]);
    // Exactly 5 -- what pins `lookCount`.
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixthId);
    // The prompt marks legality per candidate, so exclusions are asserted through `legal`.
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([blugoriId, saldeathId]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [saldeathId] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [namuleId, blugoriId, domaId, atmosId] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([saldeathId]);
    expect(view.players.south.trash).toHaveLength(0);
    // `remainderPosition: "bottom"`: the 4 land under the untouched 6th card.
    expect(engine.getState().players.south.deck).toEqual([
      sixthId,
      namuleId,
      blugoriId,
      domaId,
      atmosId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test("with no [Impel Down] card among the five, nothing is added to hand", () => {
    const engine = hannyabalWith([
      op03Namule007,
      eb01Doma005,
      op02Atmos003,
      op03Namule007,
      eb01Doma005,
    ]);
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Hannyabal's look-at-5.");
    expect(look.candidates.filter((candidate) => candidate.legal)).toHaveLength(0);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: lookedIds }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(0);
    expect(view.players.south.deckCount).toBe(5);
    expect(view.prompts).toHaveLength(0);
  });
});
