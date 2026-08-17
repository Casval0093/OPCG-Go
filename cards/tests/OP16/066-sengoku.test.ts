import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Smoker093,
  op03Namule007,
  op13MonkeyDLuffy001,
  op16Sengoku066,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

function sengokuInHand(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op16Sengoku066, op03Namule007],
      deck: [eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
      activeDon: op16Sengoku066.cost,
      donDeckCount: 6,
    },
    {},
  );
}

describe("OP16-066 Sengoku", () => {
  test("[On Play] with a [Navy] Leader: 2 rested DON!!, then draw 2 and trash 2", () => {
    const engine = sengokuInHand(op02Smoker093);

    engine.playCard(op16Sengoku066, "south");
    expect(engine.getView("south").players.south.hand).toHaveLength(1);

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // Capped at 2 by "up to 2", not by the 6 in the DON!! deck.
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1", "2"]);
    engine.resolveDecision("effectAddDon", { optionId: "2" }, "south");

    // 5 rested paying for Sengoku plus the 2 added: `state: "rested"`, not "active".
    expect(engine.getView("south").players.south).toMatchObject({
      activeDon: 0,
      restedDon: 7,
      donDeckCount: 4,
    });

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected the mandatory trash of 2.");
    // 1 card was left in hand and 2 were drawn, so all 3 are candidates and exactly 2 must go.
    expect(trash).toMatchObject({ min: 2, max: 2 });
    expect(trash.candidates).toHaveLength(3);
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: trash.candidates.slice(0, 2).map((candidate) => candidate.ref.id) },
      "south",
    );

    const view = engine.getView("south");
    // 4 in deck, 2 drawn: `amount: 2` on the draw, pinned by the deck count rather than the hand,
    // because the trash immediately takes cards back out of the hand again.
    expect(view.players.south.deckCount).toBe(2);
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.trash).toHaveLength(2);
    expect(view.prompts).toHaveLength(0);
  });

  test("without a [Navy] Leader NOTHING happens -- the draw and trash are gated too", () => {
    // The card prints a LEADING "If your Leader has the [Navy] type, ...", which ruling #944
    // (OP15-116, identical shape) says also governs the "Then, ..." half. An encoding that put
    // the check on the addDon action alone would still draw 2 and trash 2 here.
    const engine = sengokuInHand(op13MonkeyDLuffy001);

    engine.playCard(op16Sengoku066, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.deckCount).toBe(4);
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.trash).toHaveLength(0);
    expect(view.players.south).toMatchObject({ restedDon: 5, donDeckCount: 6 });
  });
});
