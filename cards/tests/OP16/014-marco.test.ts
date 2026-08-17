import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op10TrafalgarLaw119,
  op16EdwardNewgate003,
  op16Jozu007,
  op16Marco014,
  op16Namule010,
  op16Vista011,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Same technique as packages/engine/tests/cards/characters/op07-042-gecko-moria.test.ts: a
// minimal on-play "removeFromField" source so the replacement can be exercised without
// depending on some other set's specific removal card.
const returnCharacter: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP16-014-RETURN",
  canonicalId: "TEST-OP16-014-RETURN",
  name: "Test Marco Returner",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "any",
              zones: ["character"],
              count: { amount: 1 },
            },
          },
        ],
      },
    ],
  },
};

registerCards([returnCharacter]);

describe("OP16-014 Marco", () => {
  test("protects another Character from an opponent's removal by K.O.ing itself instead", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [op16Marco014, op16Namule010],
      },
      { hand: [returnCharacter] },
      { firstPlayer: "north", activeSeat: "north" },
    );
    const marcoId = engine.findCardInZone("south", "character", op16Marco014);
    const namuleId = engine.findCardInZone("south", "character", op16Namule010);

    engine.playCard(returnCharacter, "north");
    // The replacement protects "one of your Characters" generally, not only Marco itself
    // (unlike the `targetSelf: true` shape other Whitebeard cards such as OP13-046 Vista
    // use) -- so it must be offered here even though Namule, not Marco, is the one under
    // threat.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === namuleId)).toBe(true);
    expect(view.players.south.characters.some((card) => card?.instanceId === marcoId)).toBe(false);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(marcoId);
  });

  test("ruling #970: only 8000-power hand Characters can pay to replay Marco from the trash", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        character: [{ card: op16Marco014, rested: true }],
        hand: [op16Namule010, op16Jozu007, op16Vista011, op16EdwardNewgate003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10TrafalgarLaw119);
    const marcoId = engine.findCardInZone("north", "character", op16Marco014);
    // op16Namule010: 2000 power -- under 8000.
    const underPowerId = engine.findCardInZone("north", "hand", op16Namule010);
    // op16Jozu007 and op16Vista011: exactly 8000 power -- the only legal cost candidates.
    // Two of them so an ineligible-candidate assertion is actually exercised: with only one
    // legal candidate the engine auto-pays the cost without a selection prompt at all.
    const exactPowerIds = [
      engine.findCardInZone("north", "hand", op16Jozu007),
      engine.findCardInZone("north", "hand", op16Vista011),
    ];
    // op16EdwardNewgate003: 10000 power -- over 8000, also excluded by `eq`.
    const overPowerId = engine.findCardInZone("north", "hand", op16EdwardNewgate003);

    engine.declareAttack(attackerId, marcoId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    const cost = engine.pendingDecision("effectCostTrashFromHand", "north").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Marco's revival payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...exactPowerIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(overPowerId);
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [exactPowerIds[0]!] },
      "north",
    );

    const view = engine.getView("north");
    expect(view.players.north.characters.some((card) => card?.instanceId === marcoId)).toBe(true);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(exactPowerIds[0]);
    expect(view.prompts).toHaveLength(0);
  });
});
