import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Namule007, op06GeckoMoria080, op15NicoRobin087 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ACTS = { firstPlayer: "south", activeSeat: "north" } as const;

// A blocker step opens for the DEFENDING seat, so north has to be the one attacking.
// op06GeckoMoria080's only ability is a [When Attacking] on its own controller, so it stays inert
// while north attacks into it.
function robinDefendingWithTrash(trash: number) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: op06GeckoMoria080, character: [op15NicoRobin087], trash, deck: 10 },
    { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
    NORTH_ACTS,
  );
  const attackerId = engine.findCardInZone("north", "character", op02Atmos003);
  engine.declareAttack(attackerId, engine.leader("south"), "north");
  return engine;
}

function blockerCandidateIds(engine: OnePieceTestEngine) {
  const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
  if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
  // The candidate list carries a synthetic "skip" entry alongside the real blockers.
  return blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip");
}

describe("OP15-087 Nico Robin", () => {
  test("[On Play] draws 2 then trashes 2 from hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op06GeckoMoria080,
        hand: [op15NicoRobin087, op03Namule007, op02Atmos003],
        deck: 10,
        activeDon: 6,
      },
      {},
    );

    engine.playCard(op15NicoRobin087, "south");

    // Robin left the hand, then 2 were drawn: 2 + 2 = 4 to choose 2 from, so a real selection
    // prompt appears rather than an auto-payment.
    const selectable = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (selectable?.kind !== "selectEntity") throw new Error("Expected the trash selection.");
    const ids = selectable.candidates.map((candidate) => candidate.ref.id);
    expect(ids).toHaveLength(4);

    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: ids.slice(0, 2) },
      "south",
    );

    const state = engine.getState();
    expect(state.players.south.deck).toHaveLength(8);
    expect(state.players.south.hand).toHaveLength(2);
    expect(state.players.south.trash).toHaveLength(2);
  });

  test("at exactly 10 cards in the trash this Character can block", () => {
    // 10 is ON the line. `value: 10` is two digits, so mutation_check.py never perturbs it and
    // the 9-vs-10 pair below is the entirety of this threshold's coverage. Granted keywords have
    // no projected field, so the proof is functional: Robin turning up in the blocker candidates.
    const engine = robinDefendingWithTrash(10);
    const robinId = engine.findCardInZone("south", "character", op15NicoRobin087);

    expect(blockerCandidateIds(engine)).toEqual([robinId]);
  });

  test("at 9 cards in the trash there is no blocker step at all", () => {
    // Also the only thing that kills `comparison gte -> lte`: under `lte 10` a 9-card trash
    // would still grant [Blocker] and this prompt would exist.
    const engine = robinDefendingWithTrash(9);

    expect(
      engine
        .getState()
        .promptQueue.filter(
          (prompt) =>
            prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
        ),
    ).toHaveLength(0);
  });
});
