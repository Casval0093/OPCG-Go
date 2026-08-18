import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Smoker093,
  op02Thatch007,
  op03Namule007,
  op16BenevolentKingOfTheWaves071,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function kingInHand() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      // Two spare cards, so the trash cost is a real choice and actually publishes a prompt: a
      // cost with exactly one eligible candidate auto-pays silently.
      hand: [op16BenevolentKingOfTheWaves071, op03Namule007, eb01Doma005],
      activeDon: op16BenevolentKingOfTheWaves071.cost,
      donDeckCount: 5,
    },
    {},
  );
}

describe("OP16-071 Benevolent King of the Waves", () => {
  test("[On Play] trashing 1 card from hand adds 1 rested DON!!", () => {
    const engine = kingInHand();
    const namuleId = engine.findCardInZone("south", "hand", op03Namule007);
    const domaId = engine.findCardInZone("south", "hand", eb01Doma005);

    engine.playCard(op16BenevolentKingOfTheWaves071, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const pay = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    // A cost selection projects as `payCost`, not `selectEntity`.
    if (pay?.kind !== "payCost") throw new Error("Expected the trash-from-hand cost.");
    expect(pay).toMatchObject({ min: 1, max: 1 });
    // The cost carries no filters, so both spare cards are payable.
    expect(pay.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [namuleId, domaId].sort(),
    );
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [domaId] }, "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([namuleId]);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual([domaId]);
    // 3 rested paying for the body plus 1 added rested; nothing became active.
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 4, donDeckCount: 4 });
    expect(view.prompts).toHaveLength(0);
  });

  test('[On Play] declining the "you may" keeps the hand and the DON!! deck intact', () => {
    const engine = kingInHand();

    engine.playCard(op16BenevolentKingOfTheWaves071, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.trash).toHaveLength(0);
    expect(view.players.south).toMatchObject({ restedDon: 3, donDeckCount: 5 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[On K.O.] adds 1 rested DON!! for the K.O.'d card's own controller, with no cost", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      {
        leaderCardId: op02Smoker093,
        // Rested, so it is a legal attack target. north's hand is empty, so no counter step
        // interrupts the K.O.
        character: [{ card: op16BenevolentKingOfTheWaves071, rested: true }],
        donDeckCount: 5,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const kingId = engine.findCardInZone("north", "character", op16BenevolentKingOfTheWaves071);

    // 8000 into a 5000 body.
    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Thatch007),
      kingId,
      "south",
    );

    // The prompt belongs to north -- the [On K.O.] benefits the card's own controller.
    const howMany = engine.pendingDecision("effectAddDon", "north").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected north's DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "north");

    const view = engine.getView("north");
    expect(view.players.north).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 4 });
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(kingId);
  });
});
