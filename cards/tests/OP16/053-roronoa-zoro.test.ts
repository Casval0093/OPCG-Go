import { describe, expect, test } from "vite-plus/test";
import { eb02DonAccino004, op02Atmos003, op03Namule007, op16RoronoaZoro053 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const FILLER = [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003];

function attackWithZoro(handSize: number) {
  const engine = OnePieceTestEngine.create(
    {
      character: [{ card: op16RoronoaZoro053, playedOnTurn: 0 }],
      hand: [...FILLER, ...FILLER].slice(0, handSize),
      deck: [...FILLER, ...FILLER],
    },
    {
      // eb02DonAccino004 is a vanilla 10000-power body, rested so it is a legal attack target.
      // Zoro at 9000 loses the exchange, which is deliberate: nothing is K.O.'d, no Life moves,
      // and no battleCounter opens (north's hand is empty), so the only thing this test can
      // observe is the [When Attacking] draw itself.
      character: [{ card: eb02DonAccino004, playedOnTurn: 0, rested: true }],
      hand: [],
    },
    { firstPlayer: "north", activeSeat: "south" },
  );
  const zoroId = engine.findCardInZone("south", "character", op16RoronoaZoro053);
  const defenderId = engine.findCardInZone("north", "character", eb02DonAccino004);
  engine.declareAttack(zoroId, defenderId, "south");
  return engine;
}

describe("OP16-053 Roronoa Zoro", () => {
  test("at exactly 6 cards in hand, attacking draws 1", () => {
    // The hand is counted while the effect resolves and Zoro is on the field, so 6 means 6.
    // `value: 6` is a single digit -- mutation_check.py generates no numeric mutant for it, so
    // the boundary is pinned by this case (6 fires) and the next (7 does not).
    const engine = attackWithZoro(6);

    expect(engine.getView("south").players.south.hand).toHaveLength(7);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("at 7 cards in hand, attacking draws nothing", () => {
    // Also kills the lte->gte mutant: "6 or more" would draw here.
    const engine = attackWithZoro(7);

    expect(engine.getView("south").players.south.hand).toHaveLength(7);
  });

  test("with an empty hand, attacking still draws 1", () => {
    const engine = attackWithZoro(0);

    expect(engine.getView("south").players.south.hand).toHaveLength(1);
  });
});
