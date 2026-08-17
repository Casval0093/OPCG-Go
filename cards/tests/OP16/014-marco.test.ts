import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op10TrafalgarLaw119,
  op16EdwardNewgate003,
  op16Jozu007,
  op16Marco014,
  op16Namule010,
  op16PortgasDAce001,
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

// For the cardCategory boundary test below: basePower() (shared.ts) only ever reads a
// card's printed `power` for cardType "leader" or "character" -- an Event/Stage always
// basePowers to 0, so there is no way to make a non-Character hand card accidentally match
// "power eq 8000" that way. A Leader can carry power, so this synthetic Leader (deliberately
// placed in a player's HAND via the test fixture, something that never happens in real play)
// is what actually exercises the `cardCategory: "character"` filter: without it, this card's
// matching power would make it a false-positive cost candidate.
const eightThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-014-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-014-LEADER-CARD-IN-HAND",
  name: "Test 8000-Power Leader Card",
  power: 8000,
};

registerCards([returnCharacter, eightThousandPowerLeader]);

describe("OP16-014 Marco", () => {
  test("protects another Character from an opponent's removal by K.O.ing itself, then revives on its own K.O.", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [op16Marco014, op16Namule010],
        // Available to pay Marco's own [On K.O.] cost once the replacement K.O.s it --
        // this is the card's actual play pattern, not two independent abilities.
        hand: [op16Jozu007],
      },
      { hand: [returnCharacter] },
      { firstPlayer: "north", activeSeat: "north" },
    );
    const marcoId = engine.findCardInZone("south", "character", op16Marco014);
    const namuleId = engine.findCardInZone("south", "character", op16Namule010);
    const jozuId = engine.findCardInZone("south", "hand", op16Jozu007);

    engine.playCard(returnCharacter, "north");
    // The replacement protects "one of your Characters" generally, not only Marco itself
    // (unlike the `targetSelf: true` shape other Whitebeard cards such as OP13-046 Vista
    // use) -- so it must be offered here even though Namule, not Marco, is the one under
    // threat.
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");

    let view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === namuleId)).toBe(true);
    expect(view.players.south.characters.some((card) => card?.instanceId === marcoId)).toBe(false);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(marcoId);

    // The replacement's K.O. is a real K.O., not a bespoke "remove" -- it triggers Marco's
    // own [On K.O.] the same as a battle K.O. would (ruling #970's `eq` cost applies here
    // too). This chain -- protect an ally, then bring Marco back -- is why the card is
    // built this way; testing the replacement and the revival in isolation, as the previous
    // version of this test did, never exercises the fact that one causes the other.
    // Jozu is the only 8000-power Character in hand, so the cost auto-pays with no
    // selection prompt (see the `candidates.length > amount` gotcha in cards/ENCODING.md) --
    // the eq-8000 boundary itself is covered by the next test, this one is about the chain.
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === marcoId)).toBe(true);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(jozuId);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #970: only 8000-power hand Characters can pay to replay Marco from the trash", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op10TrafalgarLaw119, playedOnTurn: 0 }] },
      {
        character: [{ card: op16Marco014, rested: true }],
        hand: [
          op16Namule010,
          op16Jozu007,
          op16Vista011,
          op16EdwardNewgate003,
          eightThousandPowerLeader,
        ],
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
    // eightThousandPowerLeader: exactly 8000 power too, but cardType "leader" -- excluded
    // only by the `cardCategory: "character"` filter, not by the power filter.
    const wrongCategoryId = engine.findCardInZone("north", "hand", eightThousandPowerLeader);

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
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);
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
