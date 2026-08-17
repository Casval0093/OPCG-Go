import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op13MonkeyDLuffy001, op16MonkeyDGarp075 } from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

function garpInHand(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op16MonkeyDGarp075],
      activeDon: op16MonkeyDGarp075.cost,
      donDeckCount: 5,
    },
    {},
  );
}

describe("OP16-075 Monkey.D.Garp", () => {
  test("[On Play] with a [Navy] Leader adds one ACTIVE DON!! and one additional RESTED DON!!", () => {
    const engine = garpInHand(op02Smoker093);

    engine.playCard(op16MonkeyDGarp075, "south");

    // Two separate addDon actions, each capped at 1 by its own "up to 1".
    const first = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (first?.kind !== "chooseOption") throw new Error("Expected the active DON!! count.");
    expect(first.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");
    // 5 rested paying for Garp, and the FIRST added DON!! is the active one.
    expect(engine.getView("south").players.south).toMatchObject({ activeDon: 1, restedDon: 5 });

    const second = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (second?.kind !== "chooseOption") throw new Error("Expected the rested DON!! count.");
    expect(second.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 1, restedDon: 6, donDeckCount: 3 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[On Play] without a [Navy] Leader neither DON!! is added", () => {
    // A leading "If your Leader has the [Navy] type" gates the whole block, so BOTH halves of the
    // "and add up to 1 additional ..." sentence are suppressed, not just the first.
    const engine = garpInHand(op13MonkeyDLuffy001);

    engine.playCard(op16MonkeyDGarp075, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 5, donDeckCount: 5 });
  });
});
