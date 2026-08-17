import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Doberman107,
  op02Komille097,
  op02Smoker093,
  op03Namule007,
  op16Tsuru067,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op02Komille097 and op02Doberman107 carry "Navy"; op03Namule007 and eb01Doma005 do not.
function tsuruWith(deck: PlayerFixture["deck"]) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      hand: [op16Tsuru067, op03Namule007, eb01Doma005],
      deck,
      activeDon: op16Tsuru067.cost,
    },
    {},
  );
  engine.playCard(op16Tsuru067, "south");
  return engine;
}

describe("OP16-067 Tsuru", () => {
  test("looks at 5, keeps a [Navy] card, bottoms the rest, then trashes 1 from hand", () => {
    const engine = tsuruWith([
      op03Namule007,
      op02Komille097,
      eb01Doma005,
      op02Doberman107,
      op03Namule007,
      // A 6th card the look must never reach.
      eb01Doma005,
    ]);
    const [firstId, komilleId, thirdId, dobermanId, fifthId, sixthId] = engine.getState().players
      .south.deck as [string, string, string, string, string, string];

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Tsuru's look-at-5.");
    expect(look).toMatchObject({ min: 0, max: 1 });
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      firstId,
      komilleId,
      thirdId,
      dobermanId,
      fifthId,
    ]);
    // Exactly 5: the 6th is what pins `lookCount`.
    expect(look.candidates.map((candidate) => candidate.ref.id)).not.toContain(sixthId);
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([komilleId, dobermanId]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [komilleId] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [firstId, thirdId, dobermanId, fifthId] },
      "south",
    );

    // 2 left in hand after playing Tsuru, plus the revealed card, so the trash of 1 is a real
    // choice among 3.
    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected the mandatory trash of 1.");
    expect(trash).toMatchObject({ min: 1, max: 1 });
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toContain(komilleId);
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [engine.findCardInZone("south", "hand", eb01Doma005)] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(komilleId);
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.trash).toHaveLength(1);
    // `remainderPosition: "bottom"`: the 4 unkept cards land UNDER the untouched 6th card.
    expect(engine.getState().players.south.deck).toEqual([
      sixthId,
      firstId,
      thirdId,
      dobermanId,
      fifthId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #997: with NO [Navy] card among the five, the trash still happens", () => {
    // This is why the trash is a sibling action of the search rather than something hanging off
    // it. English reads the sequence as consequential ("reveal ..., add it ... Then, trash 1");
    // the ruling says it is unconditional (是的，丢弃).
    const engine = tsuruWith([
      op03Namule007,
      eb01Doma005,
      op03Namule007,
      eb01Doma005,
      op03Namule007,
    ]);
    const lookedIds = engine.getState().players.south.deck.slice(0, 5);

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (look?.kind !== "selectEntity") throw new Error("Expected Tsuru's look-at-5.");
    expect(look.candidates.filter((candidate) => candidate.legal)).toHaveLength(0);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision("effectSearchRemainderOrder", { selectedIds: lookedIds }, "south");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected the trash to happen anyway.");
    expect(trash.candidates).toHaveLength(2);
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [engine.findCardInZone("south", "hand", eb01Doma005)] },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.trash).toHaveLength(1);
    expect(view.players.south.deckCount).toBe(5);
    expect(view.prompts).toHaveLength(0);
  });
});
