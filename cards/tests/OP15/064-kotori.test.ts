import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Atmos003,
  op03Namule007,
  op05Hotori111,
  op05Satori105,
  op15Kotori064,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #905's scenario is a Leader whose own effect reads "has every card's name, trait and
// attribute". The engine has no `grantName` action, but the ruling is fully testable without one:
// a Leader whose STATIC name is the one being looked for is indistinguishable from a granted name
// to `cardNames()` (shared.ts). Two of them, one per printed name, because one synthetic Leader
// can only carry one name and each `hasCard` condition needs its own `zone: "field"` mutant killed.
//
// Both `name` and `i18n.en.name` must be overridden: the `name` TargetFilter resolves through
// `cardName()`, which reads `i18n.en.name`, so setting only the top-level field silently fails.
const satoriNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-064-LEADER-SATORI",
  canonicalId: "TEST-OP15-064-LEADER-SATORI",
  name: "Satori",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Satori" } },
};

const hotoriNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-064-LEADER-HOTORI",
  canonicalId: "TEST-OP15-064-LEADER-HOTORI",
  name: "Hotori",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Hotori" } },
};

registerCards([satoriNamedLeader, hotoriNamedLeader]);

// The opponent's bodies pin the `power lte 5000` filter from all three directions the mutation
// tool attacks it: eb01Doma005 at 3000 (dies to `lte -> gte`), op03Namule007 at exactly 5000
// (dies to `value 5000 -> 4000`) and op02Atmos003 at 6000 (dies to deleting the filter).
function kotoriBoard(leaderCardId: LeaderCard, allies: CharacterCard[]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [op15Kotori064, ...allies],
      // All active and no rested DON!!: one KIND of DON!! source, so `returnDon` auto-pays and
      // the test does not have to step through a payment prompt.
      activeDon: 4,
      donDeckCount: 6,
    },
    {
      leaderCardId: op16PortgasDAce001,
      character: [eb01Doma005, op03Namule007, op02Atmos003],
    },
  );
}

describe("OP15-064 Kotori", () => {
  test("with [Satori] and [Hotori]: rests an opponent Character at 5000 power or less", () => {
    const engine = kotoriBoard(op16PortgasDAce001, [op05Satori105, op05Hotori111]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);
    const underId = engine.findCardInZone("north", "character", eb01Doma005);
    const onTheLineId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Kotori's rest target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([underId, onTheLineId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [onTheLineId] }, "south");

    const state = engine.getState();
    expect(state.cards[onTheLineId]?.rested).toBe(true);
    // DON!! -2 is `returnDon`: two DON!! leave the field for the DON!! deck. `restDon` would
    // read activeDon 2 / restedDon 2 / donDeckCount 6 instead.
    expect(state.players.south).toMatchObject({ activeDon: 2, restedDon: 0, donDeckCount: 8 });
    // "You may rest this Character" is the other half of the cost.
    expect(state.cards[kotoriId]?.rested).toBe(true);
  });

  test("with [Satori] but no [Hotori]: the costs are still paid and nothing happens", () => {
    const engine = kotoriBoard(op16PortgasDAce001, [op05Satori105]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // The check sits after the cost colon, so the payment goes through and buys nothing. Moving
    // it onto the block would suppress the optional prompt entirely -- that is what separates
    // the two placements. Each printed name needs its own negative case: with both present,
    // deleting either `name` filter changes nothing and the mutant survives.
    expect(engine.getView("south").prompts).toHaveLength(0);
    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 2, restedDon: 0, donDeckCount: 8 });
    expect(state.cards[kotoriId]?.rested).toBe(true);
    expect(
      state.players.north.characterArea
        .filter((entry): entry is string => entry !== null)
        .some((entry) => state.cards[entry]?.rested),
    ).toBe(false);
  });

  test("with [Hotori] but no [Satori]: the costs are still paid and nothing happens", () => {
    const engine = kotoriBoard(op16PortgasDAce001, [op05Hotori111]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    const state = engine.getState();
    expect(
      state.players.north.characterArea
        .filter((entry): entry is string => entry !== null)
        .some((entry) => state.cards[entry]?.rested),
    ).toBe(false);
  });

  test("ruling #905: a Leader named [Satori] satisfies that half with no Satori Character", () => {
    const engine = kotoriBoard(satoriNamedLeader, [op05Hotori111]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);
    const onTheLineId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // Under `zone: "character"` the Leader is structurally outside the scan, the condition is
    // false and no prompt appears at all -- so `pendingDecision` throws here rather than
    // returning an empty candidate list.
    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Kotori's rest target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toContain(onTheLineId);
  });

  test("ruling #905: a Leader named [Hotori] satisfies that half with no Hotori Character", () => {
    const engine = kotoriBoard(hotoriNamedLeader, [op05Satori105]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);
    const onTheLineId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Kotori's rest target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toContain(onTheLineId);
  });

  test("declining the activation pays nothing", () => {
    const engine = kotoriBoard(op16PortgasDAce001, [op05Satori105, op05Hotori111]);
    const kotoriId = engine.findCardInZone("south", "character", op15Kotori064);

    engine.activateEffect(kotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 4, restedDon: 0, donDeckCount: 6 });
    expect(state.cards[kotoriId]?.rested).toBe(false);
  });
});
