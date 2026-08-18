import { describe, expect, test } from "vite-plus/test";
import { op03Namule007, op06GeckoMoria080, op15Spoil083 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function spoilOnFieldWithTrash(trash: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op06GeckoMoria080,
      character: [{ card: op15Spoil083, playedOnTurn: 0 }, op03Namule007],
      trash,
      deck: 10,
      // Seeded separately: `giveDon` with `donState: "rested"` reads `player.restedDon`, so an
      // all-active pool would silently give nothing and look like a broken condition.
      activeDon: 4,
      restedDon: 2,
    },
    {},
  );
}

function activateSpoil(engine: OnePieceTestEngine) {
  engine.exec({
    type: "activateEffect",
    seat: "south",
    sourceInstanceId: engine.findCardInZone("south", "character", op15Spoil083),
    trigger: "activateMain",
  });
  engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
}

describe("OP15-083 Spoil", () => {
  test("the [On Play] mills exactly 3", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op06GeckoMoria080, hand: [op15Spoil083], deck: 20, activeDon: 3 },
      {},
    );

    engine.playCard(op15Spoil083, "south");

    expect(engine.getState().players.south.deck).toHaveLength(17);
    expect(engine.getState().players.south.trash).toHaveLength(3);
  });

  test("ruling #923: at 14 cards in the trash it works, because the cost is the 15th", () => {
    // 可以. This is the test that would fail if the count sat on `block.conditions`: those are
    // evaluated before `payCosts` (and again at the command, which rejects with "The activation
    // conditions are not met."), so the activation would be refused at exactly the trash count
    // the ruling says is enough.
    const engine = spoilOnFieldWithTrash(14);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    activateSpoil(engine);

    // Trashing this Character is what crosses the line.
    expect(engine.getState().players.south.trash).toHaveLength(15);

    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    const state = engine.getState();
    expect(state.cards[namuleId]?.attachedDon).toBe(1);
    // The DON!! came from the RESTED pool, not the active one.
    expect(state.players.south.restedDon).toBe(1);
    expect(state.players.south.activeDon).toBe(4);
  });

  test("at 13 cards the cost is still paid and the payload simply does not happen", () => {
    // 14 after the cost, so the threshold is missed by one. The activation is nonetheless legal
    // and Spoil is nonetheless trashed -- which is the structural proof that the count gates the
    // ACTION rather than the block. It is also the only case that kills
    // `comparison gte -> lte`: under `lte 15` a 14-card trash would pay out.
    const engine = spoilOnFieldWithTrash(13);

    activateSpoil(engine);

    const state = engine.getState();
    expect(state.players.south.trash).toHaveLength(14);
    expect(state.players.south.restedDon).toBe(2);
    expect(
      state.promptQueue.filter(
        (prompt) =>
          prompt.status === "pending" && prompt.resolutionContext?.intent === "effectGiveDonCount",
      ),
    ).toHaveLength(0);
  });

  test("well clear of the line it still works", () => {
    const engine = spoilOnFieldWithTrash(20);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    activateSpoil(engine);
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    expect(engine.getState().cards[namuleId]?.attachedDon).toBe(1);
  });

  test('"up to 1" -- the DON!! may be declined', () => {
    const engine = spoilOnFieldWithTrash(20);

    activateSpoil(engine);
    engine.resolveDecision("effectGiveDonCount", { optionId: "0" }, "south");

    expect(engine.getState().players.south.restedDon).toBe(2);
  });
});
