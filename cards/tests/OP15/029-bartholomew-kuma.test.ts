import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02Smoker093,
  op05Enel098,
  op11XDrake017,
  op15BartholomewKuma029,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A minimal "rest one of your opponent's Characters" source. `cannotBeRested` has no projected
// field, so the only way to prove the restriction landed is to point a real rest effect at the
// protected body and watch it drop out of that effect's candidate pool -- paired, in the same
// call, with the unprotected body still being offered.
const rester: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-029-RESTER",
  canonicalId: "TEST-OP15-029-RESTER",
  name: "Test Kuma Rester",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "rest",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
          },
        ],
      },
    ],
  },
};

registerCards([rester]);

// op02Kingdew006 cost 5 -- exactly on the printed line
// op11XDrake017  cost 6 -- one clear of it
function kumaBoard() {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15BartholomewKuma029, rester], activeDon: 6 },
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op02Kingdew006 }, { card: op11XDrake017 }],
    },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function selectEntityCandidates(engine: OnePieceTestEngine) {
  const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
  expect(step?.kind).toBe("selectEntity");
  if (step?.kind !== "selectEntity") throw new Error("Expected an entity selection.");
  return step.candidates.map((candidate) => candidate.ref.id);
}

describe("OP15-029 Bartholomew Kuma", () => {
  test("[On Play] offers only opponent Characters with a cost of 5 or less", () => {
    const engine = kumaBoard();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);

    engine.playCard(op15BartholomewKuma029, "south");

    // Cost 5 is exactly on the line, so it pins the number; cost 6 kills both
    // `delete filter:cost` and `comparison lte -> gte`.
    expect(selectEntityCandidates(engine)).toEqual([kingdewId]);
    expect(selectEntityCandidates(engine)).not.toContain(drakeId);
  });

  test("the chosen Character genuinely cannot be rested afterwards; the other one still can", () => {
    const engine = kumaBoard();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);

    engine.playCard(op15BartholomewKuma029, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "south");

    engine.playCard(rester, "south");

    // Both halves matter. Kingdew absent is the restriction; X Drake present is the control that
    // shows the rest effect fires at all, so "absent" is not just a broken fixture.
    const candidates = selectEntityCandidates(engine);
    expect(candidates).toEqual([drakeId]);
    expect(candidates).not.toContain(kingdewId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [drakeId] }, "south");
    expect(engine.getState().cards[drakeId]?.rested).toBe(true);
    expect(engine.getState().cards[kingdewId]?.rested).toBe(false);
  });

  test("without Kuma, that same Character is restable -- the protection is what changed", () => {
    const engine = kumaBoard();
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);
    const drakeId = engine.findCardInZone("north", "character", op11XDrake017);

    engine.playCard(rester, "south");

    expect(selectEntityCandidates(engine).sort()).toEqual([kingdewId, drakeId].sort());
  });

  test("with no opponent Character at 5 cost or less nothing is published", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15BartholomewKuma029], activeDon: 6 },
      { leaderCardId: op02Smoker093, character: [{ card: op11XDrake017 }] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15BartholomewKuma029, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
