import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op03Namule007,
  op05Kotori103,
  op05Satori105,
  op15Hotori072,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #911 is the twin of #905 on OP15-064 Kotori; see that test for why a statically-named
// synthetic Leader reproduces a name-granting Leader exactly, and why both `name` and
// `i18n.en.name` have to be overridden.
const kotoriNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-072-LEADER-KOTORI",
  canonicalId: "TEST-OP15-072-LEADER-KOTORI",
  name: "Kotori",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Kotori" } },
};

const satoriNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP15-072-LEADER-SATORI",
  canonicalId: "TEST-OP15-072-LEADER-SATORI",
  name: "Satori",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Satori" } },
};

registerCards([kotoriNamedLeader, satoriNamedLeader]);

function hotoriBoard(leaderCardId: LeaderCard, allies: CharacterCard[]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [op15Hotori072, ...allies],
      activeDon: 4,
      donDeckCount: 6,
    },
    { leaderCardId: op16PortgasDAce001, character: [op02Atmos003, op03Namule007], life: 3 },
    // south is second, so its Leader may attack on its own first turn -- needed only by the
    // duration test below, which has to make a whole battle start and finish.
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("north")
    .players.north.characters.find((entry) => entry?.instanceId === instanceId)?.power;
}

describe("OP15-072 Hotori", () => {
  test("with [Kotori] and [Satori]: exactly -3000 on the chosen opponent Character", () => {
    const engine = hotoriBoard(op16PortgasDAce001, [op05Kotori103, op05Satori105]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);
    const bystanderId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Hotori's debuff target choice.");
    // No filter is printed on the target, so BOTH opponent bodies are eligible -- a filter added
    // by analogy with OP15-064 Kotori's `power lte 5000` would drop the 6000 body here.
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([victimId, bystanderId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");

    // The exact magnitude: 6000 - 3000. The mutation tool generates nothing for a negative
    // `value:`, so this equality is the only thing covering it.
    expect(powerOf(engine, victimId)).toBe(3000);
    expect(powerOf(engine, bystanderId)).toBe(5000);

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 2, restedDon: 0, donDeckCount: 8 });
    expect(state.cards[hotoriId]?.rested).toBe(true);
  });

  test('"during this turn" ends at the end of the turn', () => {
    // The only thing that separates `thisTurn` from `thisBattle` here, and it is not the obvious
    // one. A `thisBattle` modifier records `expiresAtBattleId: state.battle?.id ?? null`
    // (effects/actions.ts), and this debuff is applied in the MAIN phase, where there is no
    // battle -- so it records `null`, `cleanupBattleModifiers` never matches it, and it never
    // expires at all, not even when a later battle ends. Reading the power straight after the
    // prompt, or after an unrelated battle, is therefore green under both durations. Only turn
    // end tells them apart: `thisTurn` sets `expiresAtTurn` and is swept, `thisBattle` is not.
    const engine = hotoriBoard(op16PortgasDAce001, [op05Kotori103, op05Satori105]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");
    expect(powerOf(engine, victimId)).toBe(3000);

    engine.endTurn("south");
    expect(powerOf(engine, victimId)).toBe(6000);
  });

  test("with [Kotori] but no [Satori]: the costs are still paid and nothing happens", () => {
    const engine = hotoriBoard(op16PortgasDAce001, [op05Kotori103]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(powerOf(engine, victimId)).toBe(6000);
    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 2, restedDon: 0, donDeckCount: 8 });
    expect(state.cards[hotoriId]?.rested).toBe(true);
  });

  test("with [Satori] but no [Kotori]: the costs are still paid and nothing happens", () => {
    const engine = hotoriBoard(op16PortgasDAce001, [op05Satori105]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(powerOf(engine, victimId)).toBe(6000);
  });

  test("ruling #911: a Leader named [Kotori] satisfies that half with no Kotori Character", () => {
    const engine = hotoriBoard(kotoriNamedLeader, [op05Satori105]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");
    expect(powerOf(engine, victimId)).toBe(3000);
  });

  test("ruling #911: a Leader named [Satori] satisfies that half with no Satori Character", () => {
    const engine = hotoriBoard(satoriNamedLeader, [op05Kotori103]);
    const hotoriId = engine.findCardInZone("south", "character", op15Hotori072);
    const victimId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(hotoriId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    engine.resolveDecision("effectTargetSelection", { selectedIds: [victimId] }, "south");
    expect(powerOf(engine, victimId)).toBe(3000);
  });
});
