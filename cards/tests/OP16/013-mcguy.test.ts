import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import { op02LittleoarsJr020, op02Thatch007, op03Namule007, op16Mcguy013 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// 9000 base power debuffed to 8000 current power: safe under the printed 原本的力量 (base power),
// and a legal target under a `power` encoding. `mutation_check.py` never swaps the two filters.
const nineThousandBaseAtEight: CharacterCard = {
  ...op02LittleoarsJr020,
  id: "TEST-OP16-013-9000-BASE-AT-8000",
  canonicalId: "TEST-OP16-013-9000-BASE-AT-8000",
  name: "Test 9000-Base Body At 8000 Power",
  i18n: { en: { ...op02LittleoarsJr020.i18n.en, name: "Test 9000-Base Body At 8000 Power" } },
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

registerCards([nineThousandBaseAtEight]);

describe("OP16-013 McGuy", () => {
  test("[On K.O.] K.O.s an opponent Character with 8000 BASE power or less", () => {
    const engine = OnePieceTestEngine.create(
      // Rested, so it is a legal attack target; McGuy is 8000 power and the attacker is 9000.
      { character: [{ card: op16Mcguy013, rested: true }] },
      {
        character: [
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
          // exactly 8000 base -- the on-the-line target
          op02Thatch007,
          // 5000 -- clear of the line, so `lte` and `gte` cannot both hold
          op03Namule007,
          nineThousandBaseAtEight,
        ],
      },
      NORTH_ATTACKS,
    );
    const mcguyId = engine.findCardInZone("south", "character", op16Mcguy013);
    const attackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const boundaryId = engine.findCardInZone("north", "character", op02Thatch007);
    const wellUnderId = engine.findCardInZone("north", "character", op03Namule007);
    const debuffedId = engine.findCardInZone("north", "character", nineThousandBaseAtEight);

    expect(
      engine
        .getView("north")
        .players.north.characters.find((entry) => entry?.instanceId === debuffedId)?.power,
    ).toBe(8000);

    engine.declareAttack(attackerId, mcguyId, "north");

    expect(engine.getState().cards[mcguyId]?.zone).toBe("trash");

    // The [On K.O.] belongs to McGuy's controller, so "your opponent's Characters" is north's
    // board and the choice is south's.
    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected McGuy's K.O. target choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [boundaryId, wellUnderId].sort(),
    );
    // Both 9000-base bodies are out, including the one currently sitting at 8000 power.
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(attackerId);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(debuffedId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [boundaryId] }, "south");

    const state = engine.getState();
    expect(state.cards[boundaryId]?.zone).toBe("trash");
    expect(state.cards[wellUnderId]?.zone).toBe("character");
    expect(state.cards[attackerId]?.zone).toBe("character");
  });

  test("[On K.O.] with no eligible opponent Character publishes no prompt at all", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Mcguy013, rested: true }] },
      {
        character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }, nineThousandBaseAtEight],
      },
      NORTH_ATTACKS,
    );
    const mcguyId = engine.findCardInZone("south", "character", op16Mcguy013);
    const attackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);

    engine.declareAttack(attackerId, mcguyId, "north");

    // GENERAL ruling #27 the other way round: an `upTo` target with no legal candidate publishes
    // nothing rather than an empty choice.
    expect(engine.getState().cards[mcguyId]?.zone).toBe("trash");
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
