import { describe, expect, test } from "vite-plus/test";
import {
  op02Smoker093,
  op02Thatch007,
  op13MonkeyDLuffy001,
  op16DonquixoteRosinante070,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// 2 DON!! to play him plus 2 for the cost.
const DON_FOR_PLAY_AND_COST = op16DonquixoteRosinante070.cost + 2;

function rosinanteInHand(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op16DonquixoteRosinante070],
      activeDon: DON_FOR_PLAY_AND_COST,
      donDeckCount: 5,
    },
    {},
  );
}

describe("OP16-070 Donquixote Rosinante", () => {
  test("[On Play] with a [Navy] Leader: rest 2 DON!! to add 1 rested DON!!", () => {
    const engine = rosinanteInHand(op02Smoker093);

    engine.playCard(op16DonquixoteRosinante070, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    // 2 rested paying the play cost, 2 more rested paying the effect cost, 1 added rested. The
    // net is -1 DON!! from the DON!! deck and 0 active: `restDon` rests rather than returning, and
    // the DON!! that arrives is rested rather than active.
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 5, donDeckCount: 4 });
    expect(view.prompts).toHaveLength(0);
  });

  test('[On Play] declining the "you may" leaves the 2 DON!! active', () => {
    const engine = rosinanteInHand(op02Smoker093);

    engine.playCard(op16DonquixoteRosinante070, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 2, restedDon: 2, donDeckCount: 5 });
    expect(view.prompts).toHaveLength(0);
  });

  test("without a [Navy] Leader the cost is still payable and buys nothing", () => {
    // The [Navy] check follows the cost colon, so it gates the payload, not the payment. Moving
    // it onto the block would suppress the optional prompt entirely instead -- this is the test
    // that tells the two placements apart.
    const engine = rosinanteInHand(op13MonkeyDLuffy001);

    engine.playCard(op16DonquixoteRosinante070, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 4, donDeckCount: 5 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[Blocker] is a printed keyword and offers Rosinante on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [op16DonquixoteRosinante070] },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const rosinanteId = engine.findCardInZone("south", "character", op16DonquixoteRosinante070);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Rosinante's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(rosinanteId);
  });
});
