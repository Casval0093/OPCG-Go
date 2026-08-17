import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02LandOfWano048,
  op03Genzo046,
  op10BlueGilly054,
  op15AndNoOneElseCanHaveItItSOurMementoOfHim054,
  op15Krieg001,
  op15Lucy002,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15AndNoOneElseCanHaveItItSOurMementoOfHim054;

describe("OP15-054 And No One Else Can Have It! It's Our Memento of Him", () => {
  test("[Main] first option: draw 2, trash 1, then play a cheap [Dressrosa] Character", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Lucy002,
        hand: [CARD, op10BlueGilly054],
        activeDon: 4,
        deck: [op03Genzo046, op02Atmos003, op03Genzo046],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const blueGillyId = engine.findCardInZone("south", "hand", op10BlueGilly054);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "0" }, "south");

    // Draw 2 then trash 1 of the 4 cards now in hand.
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [engine.findCardInZone("south", "hand", op03Genzo046)] },
      "south",
    );

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected the hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toContain(blueGillyId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [blueGillyId] }, "south");

    expect(engine.findCardInZone("south", "character", op10BlueGilly054)).toBe(blueGillyId);
  });

  test("[Main] second option returns a Stage -- either player's, per the unqualified printed text", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Lucy002, hand: [CARD], activeDon: 4, deck: [op03Genzo046, op02Atmos003] },
      { stage: op02LandOfWano048 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const stageId = engine.findCardInZone("north", "stage", op02LandOfWano048);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [stageId] }, "south");

    // `player: "any"` is load-bearing: narrow it to "self" and the opponent's Stage is not a
    // candidate, so the resolve above throws.
    expect(engine.findCardInZone("north", "hand", op02LandOfWano048)).toBe(stageId);
    expect(engine.getView("north").players.north.stage).toBeFalsy();
  });

  test("with a non-Lucy Leader the whole effect does not fire", () => {
    // The leading "If your Leader is [Lucy]" gates the block, so no choice prompt appears at all.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 4,
        deck: [op03Genzo046, op02Atmos003],
      },
      { stage: op02LandOfWano048 },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(CARD, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.hand).toHaveLength(0);
  });
});
