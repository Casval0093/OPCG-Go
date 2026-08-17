import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op10BlueGilly054,
  op15FireFist020,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function fireFist(hand: unknown[] = [op15FireFist020, op03Genzo046, op02Atmos003]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op15Krieg001, hand: hand as never, activeDon: 7 },
    { character: [op10BlueGilly054] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-020 Fire Fist", () => {
  test("[Main] buffs the Leader +3000, debuffs a Character -8000, then K.O.s it at 0 or less power", () => {
    const engine = fireFist();
    const blueGillyId = engine.findCardInZone("north", "character", op10BlueGilly054);

    engine.playCard(op15FireFist020, "south");
    expect(engine.getView("south").players.south.leader.power).toBe(8000);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");
    // Blue Gilly is 5000; -8000 takes it to -3000, and GENERAL ruling #4 keeps it on the field there.
    expect(
      engine
        .getView("north")
        .players.north.characters.find((card) => card?.instanceId === blueGillyId)?.power,
    ).toBe(-3000);

    // Exactly 2 cards left in hand, so the trash cost auto-pays with no selection prompt.
    engine.resolveDecision("effectActionOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");

    expect(engine.findCardInZone("north", "trash", op10BlueGilly054)).toBe(blueGillyId);
    expect(engine.getView("south").players.south.hand).toHaveLength(0);
  });

  test("declining the optional half leaves the debuffed Character alive at negative power", () => {
    const engine = fireFist();
    const blueGillyId = engine.findCardInZone("north", "character", op10BlueGilly054);

    engine.playCard(op15FireFist020, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");
    engine.resolveDecision("effectActionOptional", { optionId: "no" }, "south");

    expect(engine.getView("north").players.north.characters.filter(Boolean)).toHaveLength(1);
    // Declining must not trash the two hand cards either -- the trash and the K.O. are one `optional`.
    expect(engine.getView("south").players.south.hand).toHaveLength(2);
  });

  test("the K.O. is restricted to 0 power or less -- an undebuffed Character is not a candidate", () => {
    // Two opponent Characters, only one of them debuffed. Relax the `power lte 0` filter and the
    // candidate list widens to both, so this goes red.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [op15FireFist020, op03Genzo046, op02Atmos003],
        activeDon: 7,
      },
      { character: [op10BlueGilly054, op02Atmos003] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const blueGillyId = engine.findCardInZone("north", "character", op10BlueGilly054);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op15FireFist020, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");
    engine.resolveDecision("effectActionOptional", { optionId: "yes" }, "south");

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected Fire Fist's K.O. target.");
    expect(ko.candidates.map((candidate) => candidate.ref.id)).toEqual([blueGillyId]);
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(atmosId);
  });
});
