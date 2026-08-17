import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op02DraculeMihawk055,
  op02Kingdew006,
  op02Thatch007,
  op03Namule007,
  op09HowlingGab006,
  op09Rockstar016,
  op16PortgasDAce001,
  op16Rockstar018,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

const NORTH_ATTACKS = { firstPlayer: "south", activeSeat: "north" } as const;

// 6000 power, but a Leader: the only card type that can satisfy `power gte 6000` without being a
// Character, so it is what makes `cardCategory: "character"` killable.
const sixThousandPowerLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-018-LEADER-CARD-IN-HAND",
  canonicalId: "TEST-OP16-018-LEADER-CARD-IN-HAND",
  name: "Test 6000-Power Leader Card",
  power: 6000,
};

registerCards([sixThousandPowerLeader]);

// op09Rockstar016 (6000) and op09HowlingGab006 (7000) are vanilla [Red-Haired Pirates] bodies;
// op03Namule007 (5000, Whitebeard Pirates) is neither payable nor protected.
function southBoard(hand: Array<{ id: string }>) {
  return {
    leaderCardId: op16PortgasDAce001,
    character: [
      op16Rockstar018,
      { card: op09Rockstar016, rested: true },
      { card: op09HowlingGab006, rested: true },
      { card: op03Namule007, rested: true },
    ],
    hand,
  };
}

function northAttackers() {
  return {
    character: [
      { card: op02Thatch007, playedOnTurn: 0 },
      { card: op02DraculeMihawk055, playedOnTurn: 0 },
    ],
  };
}

describe("OP16-018 Rockstar", () => {
  test("a [Red-Haired Pirates] Character survives by trashing a hand Character with 6000 power or more", () => {
    const engine = OnePieceTestEngine.create(
      southBoard([
        // Two payable candidates: with one the payment auto-resolves and the excluded candidates
        // are never observable.
        op09Rockstar016,
        op02Kingdew006,
        // 5000 -- excluded by `gte 6000`, and the body that kills both a deleted power filter
        // and a 5000 threshold
        op03Namule007,
        sixThousandPowerLeader,
      ]),
      northAttackers(),
      NORTH_ATTACKS,
    );
    const protectedId = engine.findCardInZone("south", "character", op09Rockstar016);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);
    const payableIds = [
      engine.findCardInZone("south", "hand", op09Rockstar016),
      engine.findCardInZone("south", "hand", op02Kingdew006),
    ];
    const underPowerId = engine.findCardInZone("south", "hand", op03Namule007);
    const wrongCategoryId = engine.findCardInZone("south", "hand", sixThousandPowerLeader);

    engine.declareAttack(attackerId, protectedId, "north");
    // A defender holding cards gets a counter step before damage resolves.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    // A `trashFromHand` battle-K.O. replacement is ONE prompt, not a confirm followed by a
    // selection: `battle.ts` builds it as a `selectCards` choice over the already-filtered hand
    // (projected `kind: "selectEntity"`, `role: "card"`), with min 0 / max 1 -- choosing none is
    // how you decline. The yes/no `battleKoReplacement` shape belongs to non-trash replacements.
    const pay = engine.pendingDecision("battleKoReplacement", "south").steps[0];
    if (pay?.kind !== "selectEntity") throw new Error("Expected Rockstar's hand-trash choice.");
    expect(pay.role).toBe("card");
    expect(pay.min).toBe(0);
    expect(pay.max).toBe(1);
    expect(pay.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...payableIds].sort(),
    );
    expect(pay.candidates.map((candidate) => candidate.ref.id)).not.toContain(underPowerId);
    expect(pay.candidates.map((candidate) => candidate.ref.id)).not.toContain(wrongCategoryId);
    engine.resolveDecision("battleKoReplacement", { selectedIds: [payableIds[0]!] }, "south");

    const state = engine.getState();
    expect(state.cards[protectedId]?.zone).toBe("character");
    expect(state.cards[payableIds[0]!]?.zone).toBe("trash");
  });

  test("declining the replacement lets the Character be K.O.'d and trashes nothing", () => {
    const engine = OnePieceTestEngine.create(
      southBoard([op09Rockstar016, op02Kingdew006]),
      northAttackers(),
      NORTH_ATTACKS,
    );
    const protectedId = engine.findCardInZone("south", "character", op09Rockstar016);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);
    const handSizeBefore = engine.getView("south").players.south.hand.length;

    engine.declareAttack(attackerId, protectedId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
    // Choosing no card is how the replacement is declined.
    engine.resolveDecision("battleKoReplacement", { selectedIds: [] }, "south");

    expect(engine.getState().cards[protectedId]?.zone).toBe("trash");
    expect(engine.getView("south").players.south.hand).toHaveLength(handSizeBefore);
  });

  test("a Character without the [Red-Haired Pirates] type is never offered the replacement", () => {
    const engine = OnePieceTestEngine.create(
      southBoard([op09Rockstar016, op02Kingdew006]),
      northAttackers(),
      NORTH_ATTACKS,
    );
    // 5000 power, ["Fish-Man Whitebeard Pirates"]: protected only if the trait filter is dropped.
    const unprotectedId = engine.findCardInZone("south", "character", op03Namule007);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, unprotectedId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(engine.getState().cards[unprotectedId]?.zone).toBe("trash");
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("ruling #973: with no 6000-power Character in hand the replacement is not offered at all", () => {
    const engine = OnePieceTestEngine.create(
      // A 5000-power Character and a Leader, neither payable.
      southBoard([op03Namule007, sixThousandPowerLeader]),
      northAttackers(),
      NORTH_ATTACKS,
    );
    const protectedId = engine.findCardInZone("south", "character", op09Rockstar016);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, protectedId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(engine.getState().cards[protectedId]?.zone).toBe("trash");
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[Once Per Turn]: a second [Red-Haired Pirates] Character the same turn is not protected", () => {
    const engine = OnePieceTestEngine.create(
      southBoard([op09Rockstar016, op02Kingdew006, op02Thatch007]),
      northAttackers(),
      NORTH_ATTACKS,
    );
    const firstId = engine.findCardInZone("south", "character", op09Rockstar016);
    const secondId = engine.findCardInZone("south", "character", op09HowlingGab006);
    const firstAttackerId = engine.findCardInZone("north", "character", op02Thatch007);
    const secondAttackerId = engine.findCardInZone("north", "character", op02DraculeMihawk055);
    const payableId = engine.findCardInZone("south", "hand", op09Rockstar016);

    engine.declareAttack(firstAttackerId, firstId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
    engine.resolveDecision("battleKoReplacement", { selectedIds: [payableId] }, "south");
    expect(engine.getState().cards[firstId]?.zone).toBe("character");

    // Still two payable Characters in hand, so only the once-per-turn guard can stop this.
    engine.declareAttack(secondAttackerId, secondId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(engine.getState().cards[secondId]?.zone).toBe("trash");
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
