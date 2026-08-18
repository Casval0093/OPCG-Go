import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op02Thatch007, op16Borsalino073 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op02Smoker093's own ability is [DON!! x1] [Activate: Main] and never fires unprompted, so the
// end-of-turn window below belongs to Borsalino alone.
function borsalinoAtEndOfTurn(rested: boolean, activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op16Borsalino073, rested, playedOnTurn: 0 }],
      activeDon,
      donDeckCount: 3,
    },
    { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP16-073 Borsalino", () => {
  test("[On Play] adds one ACTIVE DON!! and then one additional RESTED DON!!", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op16Borsalino073],
        activeDon: op16Borsalino073.cost,
        donDeckCount: 5,
      },
      {},
    );

    engine.playCard(op16Borsalino073, "south");

    // Two separate addDon actions, each capped at 1 by its own "up to 1" -- not one addDon of 2.
    const first = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (first?.kind !== "chooseOption") throw new Error("Expected the active DON!! count.");
    expect(first.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");
    // The FIRST one is the active one: 7 rested paying the cost, 1 active added.
    expect(engine.getView("south").players.south).toMatchObject({ activeDon: 1, restedDon: 7 });

    const second = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (second?.kind !== "chooseOption") throw new Error("Expected the rested DON!! count.");
    expect(second.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 1, restedDon: 8, donDeckCount: 3 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[End of Your Turn] DON!! -2 sets a rested Borsalino active and makes him a blocker", () => {
    const engine = borsalinoAtEndOfTurn(true, 2);
    const borsalinoId = engine.findCardInZone("south", "character", op16Borsalino073);

    engine.endTurn("south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // DON!! -2 is a return, so the two DON!! go back to the DON!! deck rather than resting.
    expect(engine.getView("south").players.south).toMatchObject({
      activeDon: 0,
      restedDon: 0,
      donDeckCount: 5,
    });
    expect(engine.getState().cards[borsalinoId]?.rested).toBe(false);

    // "until the end of your opponent's next End Phase" -- so the grant is still live for the
    // whole of north's turn. Granted keywords have no projected field; the blocker step is the
    // only way to observe one.
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Borsalino's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(borsalinoId);
  });

  test("ruling #998: an ALREADY-ACTIVE Borsalino may still use this to gain [Blocker]", () => {
    // The reason there is no `state: "rested"` filter and no `cardState` condition here: the
    // ruling says 是的，可以. The setActive is simply allowed to do nothing (GENERAL ruling #27).
    const engine = borsalinoAtEndOfTurn(false, 2);
    const borsalinoId = engine.findCardInZone("south", "character", op16Borsalino073);

    engine.endTurn("south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getState().cards[borsalinoId]?.rested).toBe(false);
    expect(engine.getView("south").players.south.donDeckCount).toBe(5);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Borsalino's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(borsalinoId);
  });

  test("declining the DON!! -2 leaves him rested and with no [Blocker]", () => {
    // The control that makes the two tests above mean something: same board, cost declined.
    const engine = borsalinoAtEndOfTurn(true, 2);
    const borsalinoId = engine.findCardInZone("south", "character", op16Borsalino073);

    engine.endTurn("south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().cards[borsalinoId]?.rested).toBe(true);
    expect(engine.getView("south").players.south.donDeckCount).toBe(3);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Thatch007),
      engine.leader("south"),
      "north",
    );
    // A rested Character cannot block anyway (GENERAL ruling #23), and it has no [Blocker]
    // either: no prompt at all, and the attack goes straight through to south's Life.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.lifeCount).toBe(4);
  });
});
