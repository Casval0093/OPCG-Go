import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import { op02Smoker093, op10BlueGilly054, op15BobbyFunk050, op15KellyFunk043 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Rulings #977/#979 (Bunkov/Antlerkov) settled that "if you have [Name]" counts the LEADER too,
// and they are testable today without any `grantName` action: a Leader whose static name is the
// one being looked for reproduces exactly what a name grant would look like to `cardNames()`.
// Both name fields have to be overridden -- the `name` TargetFilter resolves through
// `card.i18n.en.name`, not the top-level field.
const kellyFunkNamedLeader: LeaderCard = {
  ...op02Smoker093,
  id: "TEST-OP15-050-LEADER",
  canonicalId: "TEST-OP15-050-LEADER",
  name: "Kelly Funk",
  i18n: { en: { ...op02Smoker093.i18n.en, name: "Kelly Funk" } },
};

registerCards([kellyFunkNamedLeader]);

function bobbyOn(board: NonNullable<PlayerFixture["character"]>, leaderCardId = op02Smoker093) {
  return OnePieceTestEngine.create(
    { leaderCardId, character: [op15BobbyFunk050, ...board] },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function bobbyPower(engine: OnePieceTestEngine) {
  const bobbyId = engine.findCardInZone("south", "character", op15BobbyFunk050);
  const card = engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === bobbyId);
  if (!card || card.power === null) throw new Error("Bobby Funk was not projected with a power.");
  return card.power;
}

describe("OP15-050 Bobby Funk", () => {
  test("gains exactly +3000 while you have [Kelly Funk]", () => {
    // 3000 printed base -> 6000. The exact number matters: `value: 3000` is the one field on this
    // card the mutation tool does perturb, and only reading the number back kills it.
    expect(bobbyPower(bobbyOn([op15KellyFunk043]))).toBe(6000);
  });

  test("without [Kelly Funk] there is no bonus at all", () => {
    // Blue Gilly is a [Dressrosa] Character like Kelly Funk, so the only thing separating the two
    // boards is the card NAME.
    expect(bobbyPower(bobbyOn([op10BlueGilly054]))).toBe(3000);
  });

  test('"if you have [Kelly Funk]" counts your LEADER, with zero such Characters on the field', () => {
    // Rulings #977/#979. `zone: "field"` builds [leader, ...characters, stage]; `zone: "character"`
    // would structurally exclude the Leader and this test would read 3000.
    expect(bobbyPower(bobbyOn([], kellyFunkNamedLeader))).toBe(6000);
  });
});
