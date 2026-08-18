import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op16Mr1DazBonez054 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const FILLER = [op02Atmos003, op03Namule007, op02Atmos003, op03Namule007, op02Atmos003];

function handOf(count: number) {
  return Array.from({ length: count }, (_, index) => FILLER[index % FILLER.length]!);
}

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("south")
    .players.south.characters.find((card) => card?.instanceId === instanceId)?.power;
}

describe("OP16-054 Mr.1(Daz.Bonez)", () => {
  test("[DON!! x1] [Your Turn] with 5 cards in hand: 2000 base + 1000 from the DON!! + 3000 = 6000", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr1DazBonez054, playedOnTurn: 0 }],
        hand: handOf(5),
        activeDon: 3,
      },
      {},
    );
    const mr1Id = engine.findCardInZone("south", "character", op16Mr1DazBonez054);
    expect(powerOf(engine, mr1Id)).toBe(2000);

    engine.attachDon(mr1Id, 1, "south");

    // Exact number, not just "bigger". A candidate list or a "power went up" assertion cannot
    // distinguish +3000 from +2000, which is the mutant mutation_check.py generates here.
    // The attached DON!! itself is worth +1000, so the total is 2000 + 1000 + 3000.
    expect(powerOf(engine, mr1Id)).toBe(6000);
  });

  test("with only 4 cards in hand the bonus does not apply", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr1DazBonez054, playedOnTurn: 0 }],
        hand: handOf(4),
        activeDon: 3,
      },
      {},
    );
    const mr1Id = engine.findCardInZone("south", "character", op16Mr1DazBonez054);

    engine.attachDon(mr1Id, 1, "south");

    // 2000 + 1000 from the DON!! and nothing else. This is what kills the gte->lte mutant:
    // "5 or less" would fire at 4.
    expect(powerOf(engine, mr1Id)).toBe(3000);
  });

  test("without an attached DON!! the bonus does not apply, however big the hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr1DazBonez054, playedOnTurn: 0 }],
        hand: handOf(8),
        activeDon: 3,
      },
      {},
    );
    const mr1Id = engine.findCardInZone("south", "character", op16Mr1DazBonez054);

    expect(powerOf(engine, mr1Id)).toBe(2000);
  });

  test("[Your Turn]: the bonus falls away on the opponent's turn even with the DON!! still attached", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr1DazBonez054, playedOnTurn: 0 }],
        hand: handOf(5),
        activeDon: 3,
      },
      {},
    );
    const mr1Id = engine.findCardInZone("south", "character", op16Mr1DazBonez054);

    engine.attachDon(mr1Id, 1, "south");
    expect(powerOf(engine, mr1Id)).toBe(6000);

    engine.endTurn("south");

    // The DON!! is still physically attached -- it is only returned at the start of its own
    // controller's next turn -- but getCardPower only counts attached DON!! while its
    // controller is the ACTIVE seat, so on the opponent's turn it contributes 0 as well.
    // Both halves of the 4000 drop are therefore expected; what this pins is the [Your Turn]
    // clause, because without the `turn: "your"` condition the reading here would be
    // 2000 + 3000 = 5000.
    const projected = engine
      .getView("south")
      .players.south.characters.find((card) => card?.instanceId === mr1Id);
    expect(projected?.attachedDon).toBe(1);
    expect(projected?.power).toBe(2000);
  });

  test("[On Play] draws 1 card", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Mr1DazBonez054],
        deck: [op03Namule007, ...FILLER, ...FILLER],
        activeDon: 2,
      },
      {},
    );
    const topId = engine.findCardInZone("south", "deck", op03Namule007);

    engine.playCard(op16Mr1DazBonez054, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([topId]);
    expect(view.prompts).toHaveLength(0);
  });
});
