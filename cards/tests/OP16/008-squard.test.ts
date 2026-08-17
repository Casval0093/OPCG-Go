import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb02DonAccino004,
  op02LittleoarsJr020,
  op02Thatch007,
  op03Namule007,
  op12Shiki005,
  op16Squard008,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

function selfPowerModifier(value: number) {
  return {
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyPower" as const,
            target: {
              player: "self" as const,
              zones: ["character" as const],
              count: { amount: 1 },
              self: true,
            },
            value,
            duration: "permanent" as const,
          },
        ],
      },
    ],
  };
}

// 10000 base power sitting at 12000 current power. The cost prints 原本的力量 (base power), so
// this body IS a legal payment; a `power eq 10000` encoding would reject it. The mutation checker
// never swaps `basePower` for `power`, so this is hand-written coverage.
const tenThousandBaseAtTwelve: CharacterCard = {
  ...op12Shiki005,
  id: "TEST-OP16-008-10000-BASE-AT-12000",
  canonicalId: "TEST-OP16-008-10000-BASE-AT-12000",
  name: "Test 10000-Base Body At 12000 Power",
  i18n: { en: { ...op12Shiki005.i18n.en, name: "Test 10000-Base Body At 12000 Power" } },
  effects: selfPowerModifier(2000),
};

// 11000 base power: the vanilla pool tops out at 10000, so `eq` -> `gte` is unkillable without a
// body above the line.
const elevenThousandBase: CharacterCard = {
  ...op12Shiki005,
  id: "TEST-OP16-008-11000-BASE",
  canonicalId: "TEST-OP16-008-11000-BASE",
  name: "Test 11000-Base Body",
  i18n: { en: { ...op12Shiki005.i18n.en, name: "Test 11000-Base Body" } },
  power: 11000,
};

// 9000 base power debuffed to 8000 current power: eligible for the K.O. under the printed
// "8000 power", excluded under a `basePower` reading. The mirror of the cost-side synthetic.
const nineThousandBaseAtEight: CharacterCard = {
  ...op02LittleoarsJr020,
  id: "TEST-OP16-008-9000-BASE-AT-8000",
  canonicalId: "TEST-OP16-008-9000-BASE-AT-8000",
  name: "Test 9000-Base Body At 8000 Power",
  i18n: { en: { ...op02LittleoarsJr020.i18n.en, name: "Test 9000-Base Body At 8000 Power" } },
  effects: selfPowerModifier(-1000),
};

registerCards([tenThousandBaseAtTwelve, elevenThousandBase, nineThousandBaseAtEight]);

describe("OP16-008 Squard", () => {
  test("ruling #966: the trash cost takes a Character with exactly 10000 BASE power, and K.O.s an opponent Character at 8000 power or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Squard008],
        character: [
          // 10000 base -- eligible. Two eligible bodies are required or the cost auto-pays with
          // no prompt and the excluded candidates cannot be observed.
          eb02DonAccino004,
          tenThousandBaseAtTwelve,
          // 9000 base -- below the line, excluded by `eq` (and by a 9000 threshold it would not be)
          op02LittleoarsJr020,
          // 11000 base -- above the line, excluded by `eq` but accepted by `gte`
          elevenThousandBase,
        ],
        activeDon: op16Squard008.cost,
      },
      {
        character: [
          // exactly 8000 -- the on-the-line K.O. candidate
          op02Thatch007,
          // 5000 -- clear of the line, so `lte` and `gte` cannot both hold
          op03Namule007,
          // 9000 -- the only body the K.O. filter itself excludes
          op02LittleoarsJr020,
          nineThousandBaseAtEight,
        ],
      },
    );
    const eligibleCostIds = [
      engine.findCardInZone("south", "character", eb02DonAccino004),
      engine.findCardInZone("south", "character", tenThousandBaseAtTwelve),
    ];
    const underBaseId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const overBaseId = engine.findCardInZone("south", "character", elevenThousandBase);
    const koBoundaryId = engine.findCardInZone("north", "character", op02Thatch007);
    const koWellUnderId = engine.findCardInZone("north", "character", op03Namule007);
    const koTooStrongId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const koDebuffedId = engine.findCardInZone("north", "character", nineThousandBaseAtEight);

    // The two synthetics really do sit where the comment claims.
    const southBoard = engine.getView("south").players.south.characters;
    expect(southBoard.find((entry) => entry?.instanceId === eligibleCostIds[1])?.power).toBe(12000);
    const northBoard = engine.getView("south").players.north.characters;
    expect(northBoard.find((entry) => entry?.instanceId === koDebuffedId)?.power).toBe(8000);

    engine.playCard(op16Squard008, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashCharacter", "south").steps[0];
    if (cost?.kind !== "payCost") throw new Error("Expected Squard's trash payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...eligibleCostIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underBaseId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overBaseId);
    engine.resolveDecision(
      "effectCostTrashCharacter",
      { selectedIds: [eligibleCostIds[0]!] },
      "south",
    );
    expect(engine.getState().cards[eligibleCostIds[0]!]?.zone).toBe("trash");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Squard's K.O. target choice.");
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [koBoundaryId, koWellUnderId, koDebuffedId].sort(),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(koTooStrongId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [koBoundaryId] }, "south");

    const state = engine.getState();
    expect(state.cards[koBoundaryId]?.zone).toBe("trash");
    expect(state.cards[koTooStrongId]?.zone).toBe("character");
  });

  test("with no 10000-base-power Character to trash the [On Play] is never offered", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16Squard008],
        character: [op02LittleoarsJr020, elevenThousandBase],
        activeDon: op16Squard008.cost,
      },
      { character: [op03Namule007] },
    );
    const survivorId = engine.findCardInZone("north", "character", op03Namule007);

    engine.playCard(op16Squard008, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[survivorId]?.zone).toBe("character");
  });
});
