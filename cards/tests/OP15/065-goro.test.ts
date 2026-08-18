import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Sai012,
  op03Namule007,
  op15Goro065,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// `donDeckCount: 6` is well above the printed cap of 1, so the `effectAddDon` option list
// `["0", "1"]` proves "up to 1" rather than an exhausted DON!! deck -- `addDon` caps its choice
// at min(amount, donDeckCount).
function goroRevealing(topCard: typeof op01Sai012) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      hand: [op15Goro065],
      deck: [topCard, op03Namule007, eb01Doma005],
      activeDon: op15Goro065.cost,
      donDeckCount: 6,
    },
    { leaderCardId: op16PortgasDAce001 },
  );
  engine.playCard(op15Goro065, "south");
  return engine;
}

describe("OP15-065 Goro", () => {
  test("[On Play] a revealed cost-2 card adds up to 1 RESTED DON!! and stays on top of the deck", () => {
    // Exactly on the printed line: "a cost of 2 or less". `value: 2` is single-digit, so the
    // mutation tool never perturbs it -- this fixture is the boundary cover.
    const engine = goroRevealing(op01Sai012);
    const revealedId = engine.getState().players.south.deck[0];

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const state = engine.getState();
    // Goro's own cost rested 3 DON!!; the added one arrives RESTED, not active, so activeDon
    // stays 0 and restedDon reads 4. `state: "active"` would read activeDon 1 / restedDon 3.
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 4, donDeckCount: 5 });
    // `revealFromDeck` leaves the card where it was. `revealTopDeckCard` would have demanded a
    // finalPosition and could have moved it -- the printed text gives no placement instruction.
    expect(state.players.south.deck[0]).toBe(revealedId);
    expect(state.players.south.deck).toHaveLength(3);
  });

  test("[On Play] a revealed cost-1 card also qualifies", () => {
    // "2 or LESS": the case that separates `lte 2` from `gte 2`, which are identical at 2.
    const engine = goroRevealing(eb01Doma005);

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    expect(engine.getState().players.south).toMatchObject({ restedDon: 4, donDeckCount: 5 });
  });

  test("[On Play] a revealed cost-3 card adds nothing", () => {
    const engine = goroRevealing(op03Namule007);

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south).toMatchObject({
      activeDon: 0,
      restedDon: 3,
      donDeckCount: 6,
    });
  });

  test('[On Play] choosing "0" is a real option and adds nothing', () => {
    const engine = goroRevealing(op01Sai012);

    engine.resolveDecision("effectAddDon", { optionId: "0" }, "south");
    expect(engine.getState().players.south).toMatchObject({ restedDon: 3, donDeckCount: 6 });
  });
});
