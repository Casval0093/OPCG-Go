import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op03Arlong022, op15HodyJones033 } from "@tcg/op-cards";

import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op03Arlong022's traits are ONE concatenated string, "Fish-Man Arlong Pirates East Blue", so
// `match: "includes"` is load-bearing here rather than decorative; its only ability is a
// [DON!! x2] [When Attacking], which never fires below because no DON!! is attached.
// op02Smoker093 is [Navy] -- the same Leader shape with the wrong trait.
//
// There is no fixture field for a rested Leader, so every case below rests it the only way the
// engine allows: by attacking with it. That also makes "set as active" an observable change rather
// than a no-op.
function hodyAfterLeaderAttack(leaderCardId: CardRef, life: number) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId, hand: [op15HodyJones033], activeDon: 10, life },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
  engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");
  expect(engine.getState().cards[engine.leader("south")]?.rested).toBe(true);
  return engine;
}

describe("OP15-033 Hody Jones", () => {
  test("[On Play] sets a [Fish-Man] Leader active and banks the top Life card", () => {
    const engine = hodyAfterLeaderAttack(op03Arlong022, 3);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15HodyJones033, "south");

    const state = engine.getState();
    expect(state.cards[engine.leader("south")]?.rested).toBe(false);
    expect(state.players.south.life).toHaveLength(2);
    // -1 for playing Hody, +1 for the Life card.
    expect(state.players.south.hand).toHaveLength(handBefore);
  });

  test("ruling #889: at 0 Life the Leader is STILL set active", () => {
    // 可以. The two printed sentences are two independent actions in one block, ordered as
    // printed, which is what makes the first survive the second having nothing to do. A
    // `thenActions`/`conditional` shape, or a `lifeCount` condition on the block, would both fail
    // this and both read naturally from the English.
    const engine = hodyAfterLeaderAttack(op03Arlong022, 0);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15HodyJones033, "south");

    const state = engine.getState();
    expect(state.cards[engine.leader("south")]?.rested).toBe(false);
    expect(state.players.south.life).toHaveLength(0);
    expect(state.players.south.hand).toHaveLength(handBefore - 1);
  });

  test("with a non-[Fish-Man] Leader the Leader stays rested but the Life card still moves", () => {
    // The mirror of the ruling above, and the fixture that kills `delete filter:trait`: without
    // the trait filter a [Navy] Leader would be set active here. It also shows the second action
    // does not depend on the first.
    const engine = hodyAfterLeaderAttack(op02Smoker093, 3);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op15HodyJones033, "south");

    const state = engine.getState();
    expect(state.cards[engine.leader("south")]?.rested).toBe(true);
    expect(state.players.south.life).toHaveLength(2);
    expect(state.players.south.hand).toHaveLength(handBefore);
  });
});
