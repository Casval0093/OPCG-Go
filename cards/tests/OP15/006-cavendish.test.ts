import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Seaquake021,
  op03FireFist018,
  op03Namule007,
  op04Barrier095,
  op04GumGumKingKongGun093,
  op04TruenoBastardo094,
  op05DragonClaw095,
  op05FourThousandBrickFist020,
  op15Cavendish006,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

const EVENTS = [
  op02Seaquake021,
  op04Barrier095,
  op05DragonClaw095,
  op04TruenoBastardo094,
  op04GumGumKingKongGun093,
  op03FireFist018,
  op05FourThousandBrickFist020,
];

function cavendishWithTrash(trash: PlayerFixture["trash"]) {
  const engine = OnePieceTestEngine.create(
    { character: [op15Cavendish006], trash },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
  const cavendishId = engine.findCardInZone("south", "character", op15Cavendish006);
  return engine
    .getView("south")
    .players.south.characters.find((card) => card?.instanceId === cavendishId)?.power;
}

describe("OP15-006 Cavendish", () => {
  test("exactly 4 Events in the trash is enough, and the boost is exactly +2000", () => {
    // 4000 printed. `value: 2000` DOES generate a mutant (2000 -> 1000), and only an exact
    // assertion kills it -- "is it boosted at all" would stay green at +1000.
    expect(cavendishWithTrash(EVENTS.slice(0, 4))).toBe(6000);
  });

  test("3 Events is not enough, even with other cards padding the trash to 5", () => {
    // The padding is the point: `delete filter:cardCategory` turns this into a bare `zoneCount gte
    // 4` over the whole trash, which 5 cards satisfy. Without the two Characters here that mutant
    // would survive.
    expect(cavendishWithTrash([...EVENTS.slice(0, 3), op02Atmos003, op03Namule007])).toBe(4000);
  });

  test("well clear of the line -- 6 Events still boosts", () => {
    // `gte` and `lte` are indistinguishable at exactly 4, so this is what kills the
    // `comparison: "gte" -> "lte"` mutant.
    expect(cavendishWithTrash(EVENTS.slice(0, 6))).toBe(6000);
  });

  test("an empty trash leaves the printed power untouched", () => {
    expect(cavendishWithTrash([])).toBe(4000);
  });
});
