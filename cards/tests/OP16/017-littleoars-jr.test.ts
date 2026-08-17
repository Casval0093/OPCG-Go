import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02LittleoarsJr020,
  op02Thatch007,
  op05JohnGiant044,
  op16LittleoarsJr017,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// The vanilla pool has no cost-8 [Whitebeard Pirates] Character -- it tops out at cost 7 -- so
// the only body that satisfies BOTH halves of the condition has to be synthesised. Its traits
// are "Giant Whitebeard Pirates Allies", which also exercises GENERAL ruling #39: "a type
// including X" covers 〈X Allies〉.
const costEightWhitebeard: CharacterCard = {
  ...op02LittleoarsJr020,
  id: "TEST-OP16-017-COST-8-WHITEBEARD",
  canonicalId: "TEST-OP16-017-COST-8-WHITEBEARD",
  name: "Test Cost-8 Whitebeard Body",
  i18n: { en: { ...op02LittleoarsJr020.i18n.en, name: "Test Cost-8 Whitebeard Body" } },
  cost: 8,
};

registerCards([costEightWhitebeard]);

function littleOarsPower(
  engine: OnePieceTestEngine,
  instanceId: string,
): number | null | undefined {
  return engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === instanceId)?.power;
}

describe("OP16-017 LittleOars Jr.", () => {
  test("neither a cheap Whitebeard body nor an expensive non-Whitebeard one lifts the -4000", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [
          op16LittleoarsJr017,
          // cost 6, ["Whitebeard Pirates"] -- fails the cost half only
          op02Thatch007,
          // cost 8, ["Giant", "Navy"] -- fails the trait half only
          op05JohnGiant044,
          // cost 7, Whitebeard Pirates Allies -- one step under the boundary. The threshold is a
          // single-digit value, which `mutation_check.py` never perturbs, so this pins it by hand.
          op02LittleoarsJr020,
        ],
      },
      {},
    );
    const littleOarsId = engine.findCardInZone("south", "character", op16LittleoarsJr017);

    // 8000 printed - 4000.
    expect(littleOarsPower(engine, littleOarsId)).toBe(4000);
  });

  test("a cost-8 [Whitebeard Pirates Allies] Character lifts the debuff", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op16LittleoarsJr017, costEightWhitebeard],
      },
      {},
    );
    const littleOarsId = engine.findCardInZone("south", "character", op16LittleoarsJr017);

    expect(littleOarsPower(engine, littleOarsId)).toBe(8000);
  });

  test("alone on the field it is debuffed: its own cost-4 body does not satisfy the condition", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op16PortgasDAce001, character: [op16LittleoarsJr017] },
      {},
    );
    const littleOarsId = engine.findCardInZone("south", "character", op16LittleoarsJr017);

    expect(littleOarsPower(engine, littleOarsId)).toBe(4000);
  });

  test("[Blocker] offers this Character as a block target on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op16PortgasDAce001, character: [op16LittleoarsJr017] },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      NORTH_ATTACKS,
    );
    const littleOarsId = engine.findCardInZone("south", "character", op16LittleoarsJr017);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, engine.leader("south"), "north");

    const block = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (block?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(block.candidates.map((candidate) => candidate.ref.id)).toContain(littleOarsId);
  });
});
