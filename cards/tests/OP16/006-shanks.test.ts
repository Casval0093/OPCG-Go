import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import { eb01Doma005, op03Genzo046, op03Namule007, op16Shanks006 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A 5000-base-power body permanently debuffed to 4000. `power` and `basePower` are separate
// filters and `mutation_check.py` never swaps one for the other, so this is the hand-written
// half: it is eligible under the printed "4000 power" (`power`) and would be excluded under a
// `basePower` encoding.
const debuffedToFour: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP16-006-5000-BASE-DEBUFFED-TO-4000",
  canonicalId: "TEST-OP16-006-5000-BASE-DEBUFFED-TO-4000",
  name: "Test 5000-Base Body At 4000 Power",
  i18n: { en: { ...op03Namule007.i18n.en, name: "Test 5000-Base Body At 4000 Power" } },
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: -1000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
};

registerCards([debuffedToFour]);

describe("OP16-006 Shanks", () => {
  test("[On Play] rests 2 DON!! to K.O. an opponent Character with 4000 power or less", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16Shanks006], activeDon: op16Shanks006.cost + 2 },
      {
        character: [
          // exactly 4000 -- the on-the-line body that pins the threshold
          op03Genzo046,
          // 3000 -- clear of the line, so `lte` and `gte` cannot both hold
          eb01Doma005,
          // 5000 -- the only body the filter itself excludes
          op03Namule007,
          debuffedToFour,
        ],
      },
    );
    const boundaryId = engine.findCardInZone("north", "character", op03Genzo046);
    const wellUnderId = engine.findCardInZone("north", "character", eb01Doma005);
    const tooStrongId = engine.findCardInZone("north", "character", op03Namule007);
    const debuffedId = engine.findCardInZone("north", "character", debuffedToFour);

    // The synthetic body really is a 5000-base card sitting at 4000 power.
    const before = engine.getView("south").players.north.characters;
    expect(before.find((entry) => entry?.instanceId === debuffedId)?.power).toBe(4000);

    engine.playCard(op16Shanks006, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // Paying the cost rests 2 DON!! on top of the 4 the play itself rested.
    expect(engine.getView("south").players.south.restedDon).toBe(op16Shanks006.cost + 2);

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Shanks's K.O. target choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, wellUnderId, debuffedId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooStrongId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [boundaryId] }, "south");

    const state = engine.getState();
    expect(state.cards[boundaryId]?.zone).toBe("trash");
    expect(state.cards[wellUnderId]?.zone).toBe("character");
    expect(state.cards[tooStrongId]?.zone).toBe("character");
  });

  test("declining the DON!! cost K.O.s nothing and rests no extra DON!!", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16Shanks006], activeDon: op16Shanks006.cost + 2 },
      { character: [op03Genzo046] },
    );
    const survivorId = engine.findCardInZone("north", "character", op03Genzo046);

    engine.playCard(op16Shanks006, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().cards[survivorId]?.zone).toBe("character");
    expect(engine.getView("south").players.south.restedDon).toBe(op16Shanks006.cost);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
