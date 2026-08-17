import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op01Sai012,
  op03Namule007,
  op05Enel098,
  op08Kalgara098,
  op15MontBlancNoland111,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A vanilla body named "Kalgara". Both name fields have to be overridden: `cardName()`
// (effects/shared.ts) resolves a card's name from `card.i18n.en.name`, not the top-level `name`,
// and the two only agree by construction in generated cards. Using a synthetic keeps the real
// Kalgara printings' own [On Play] effects out of the way of a [Rush] test.
const kalgaraBody: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP15-111-KALGARA",
  canonicalId: "TEST-OP15-111-KALGARA",
  name: "Kalgara",
  i18n: { en: { ...op03Namule007.i18n.en, name: "Kalgara" } },
};

registerCards([kalgaraBody]);

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function nolandAttacking(
  hand: PlayerFixture["hand"],
  character: PlayerFixture["character"],
  leaderCardId: PlayerFixture["leaderCardId"] = op05Enel098,
) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [{ card: op15MontBlancNoland111, playedOnTurn: 0 }, ...(character ?? [])],
      hand,
      activeDon: 5,
    },
    // Explicit trigger-free Life cards so a connecting attack does not publish a lifeTrigger.
    { life: [op01Sai012, op01Sai012, op01Sai012] },
    SOUTH_ATTACKS,
  );
}

describe("OP15-111 Mont Blanc Noland", () => {
  test("[DON!! x1] [When Attacking] grants [Rush] to a [Kalgara] played this turn", () => {
    const engine = nolandAttacking([kalgaraBody], []);
    const nolandId = engine.findCardInZone("south", "character", op15MontBlancNoland111);

    engine.playCard(kalgaraBody, "south");
    const kalgaraId = engine.findCardInZone("south", "character", kalgaraBody);
    engine.attachDon(nolandId, 1, "south");

    engine.declareAttack(nolandId, engine.leader("north"), "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kalgaraId] }, "south");

    // The functional proof: Kalgara was played this turn, so without the grant the engine refuses
    // the attack outright.
    expect(
      engine.exec({
        type: "declareAttack",
        seat: "south",
        attackerId: kalgaraId,
        targetId: engine.leader("north"),
      }).accepted,
    ).toBe(true);
  });

  test('the [Kalgara] LEADER is inside the pool -- the card prints "cards", not "Characters"', () => {
    // op08Kalgara098 is a real Leader named Kalgara. Narrow the target to zones: ["character"]
    // and this goes red -- with no Kalgara Character on the field there would be no prompt at all.
    const engine = nolandAttacking([], [], op08Kalgara098);
    const nolandId = engine.findCardInZone("south", "character", op15MontBlancNoland111);
    engine.attachDon(nolandId, 1, "south");

    engine.declareAttack(nolandId, engine.leader("north"), "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a target selection.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([
      engine.leader("south"),
    ]);
  });

  test("a Character with a different name is not a candidate", () => {
    const engine = nolandAttacking([], [{ card: op03Namule007, playedOnTurn: 0 }]);
    const nolandId = engine.findCardInZone("south", "character", op15MontBlancNoland111);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    engine.attachDon(nolandId, 1, "south");

    engine.declareAttack(nolandId, engine.leader("north"), "south");

    // Namule is the very card the synthetic Kalgara is spread from, so the only difference
    // between them is the name -- drop the `name` filter and this goes red.
    expect(
      engine.getState().promptQueue.filter((prompt) => prompt.status === "pending"),
    ).toHaveLength(0);
    expect(engine.getState().cards[namuleId]?.rested).toBe(false);
  });

  test("without DON!! attached the [When Attacking] effect does not fire", () => {
    const engine = nolandAttacking([], [{ card: kalgaraBody, playedOnTurn: 0 }]);
    const nolandId = engine.findCardInZone("south", "character", op15MontBlancNoland111);

    engine.declareAttack(nolandId, engine.leader("north"), "south");

    expect(
      engine.getState().promptQueue.filter((prompt) => prompt.status === "pending"),
    ).toHaveLength(0);
  });
});
