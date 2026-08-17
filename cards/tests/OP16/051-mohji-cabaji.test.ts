import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op16MohjiCabaji051 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const FILLER = [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003];

function handWith(extras: number) {
  return [
    op16MohjiCabaji051,
    ...Array.from({ length: extras }, (_, index) => FILLER[index % FILLER.length]!),
  ];
}

describe("OP16-051 Mohji & Cabaji", () => {
  test("at exactly 5 cards left in hand after playing, it draws 2", () => {
    const engine = OnePieceTestEngine.create(
      // 6 in hand -> Mohji & Cabaji leaves -> 5 remain when the [On Play] resolves. The
      // condition is evaluated after the card has left the hand, so the printed 5 is the
      // count of the OTHER cards. `value: 5` is a single digit and mutation_check.py never
      // perturbs it; this case pins it from below and the 6-card case below pins it from above.
      { hand: handWith(5), deck: [...FILLER, ...FILLER], activeDon: 6 },
      {},
    );

    engine.playCard(op16MohjiCabaji051, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(7);
    expect(view.prompts).toHaveLength(0);
  });

  test("at 6 cards left in hand it draws nothing", () => {
    const engine = OnePieceTestEngine.create(
      { hand: handWith(6), deck: [...FILLER, ...FILLER], activeDon: 6 },
      {},
    );

    engine.playCard(op16MohjiCabaji051, "south");

    // This is also what kills the lte->gte mutant: "6 or more" would fire here.
    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(6);
    expect(view.prompts).toHaveLength(0);
  });

  test("with an empty hand after playing, it still draws 2", () => {
    const engine = OnePieceTestEngine.create(
      { hand: handWith(0), deck: [...FILLER, ...FILLER], activeDon: 6 },
      {},
    );

    engine.playCard(op16MohjiCabaji051, "south");

    // "5 or less" is genuinely "or less", not a window -- 0 qualifies.
    expect(engine.getView("south").players.south.hand).toHaveLength(2);
  });
});
