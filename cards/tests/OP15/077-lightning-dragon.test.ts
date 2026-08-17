import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Thatch007,
  op03Genzo046,
  op15Krieg001,
  op15LightningDragon077,
} from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15LightningDragon077;

describe("OP15-077 Lightning Dragon", () => {
  test("carries NO [Enel] condition -- it works under an unrelated Leader", () => {
    // The decisive test for this card. Its siblings OP15-074/075/076 all gate their [Main] on an
    // [Enel] Leader; neither this card's printed English nor the SC text quoted in ruling #916 does.
    // Adding the condition by analogy would make this go red at 0 cards drawn.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      { character: [{ card: op03Genzo046, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(1);
    expect(engine.getView("south").players.south.activeDon).toBe(0);
  });

  test("the freeze is restricted to RESTED opponent Characters at 6000 power or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      {
        // The included body sits EXACTLY on the threshold, which is what pins `value: 6000`: with a
        // 4000 body there instead, mutating the threshold to 5000 changes nothing and the mutant
        // survives. That is exactly what happened before this fixture was rebuilt.
        character: [
          { card: op02Atmos003, rested: true }, // 6000, rested  -> eligible, ON the boundary
          { card: op03Genzo046, rested: false }, // 4000, ACTIVE -> excluded by `state`
          { card: op02Thatch007, rested: true }, // 8000, rested -> excluded by `power`
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const restedSmallId = engine.findCardInZone("north", "character", op02Atmos003);
    const activeId = engine.findCardInZone("north", "character", op03Genzo046);
    const restedBigId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.playCard(CARD, "south");

    const freeze = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(freeze?.kind).toBe("selectEntity");
    if (freeze?.kind !== "selectEntity") throw new Error("Expected the freeze target.");
    const candidateIds = freeze.candidates.map((candidate) => candidate.ref.id);
    // Each exclusion is caused by a different filter, so dropping either one goes red here.
    expect(candidateIds).toEqual([restedSmallId]);
    expect(candidateIds).not.toContain(activeId);
    expect(candidateIds).not.toContain(restedBigId);
  });

  test("a frozen Character does not become active in its controller's Refresh Phase", () => {
    // Proves `freeze` really is the printed "will not become active in your opponent's next Refresh
    // Phase" rather than a plain rest, by advancing into north's turn and checking it stayed rested.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        deck: [op03Genzo046, op02Atmos003],
      },
      { character: [{ card: op03Genzo046, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const targetId = engine.findCardInZone("north", "character", op03Genzo046);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");
    engine.endTurn("south");

    expect(
      engine.getView("north").players.north.characters.find((card) => card?.instanceId === targetId)
        ?.rested,
    ).toBe(true);
    void getLegalCommands;
  });
});
