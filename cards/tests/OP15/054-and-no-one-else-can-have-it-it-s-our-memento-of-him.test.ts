import { describe, expect, test } from "vite-plus/test";
import {
  eb03Viola030,
  op02Atmos003,
  op02LandOfWano048,
  op03Genzo046,
  op03Namule007,
  op04CorridaColiseum096,
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
        // One legal play plus one counterexample per filter on the action. With only Blue Gilly in
        // hand all three filters were free and all three mutants survived:
        //   op03Namule007            cost 3, Whitebeard Pirates -> wrong trait
        //   eb03Viola030             cost 5, Dressrosa          -> wrong cost
        //   op04CorridaColiseum096   cost 1, Dressrosa, STAGE   -> wrong cardCategory
        // The last must be a Stage, not an Event: candidatesForPlayAction hard-filters the pool to
        // stage-or-character before `cardCategory` is consulted, so an Event proves nothing.
        hand: [CARD, op10BlueGilly054, op03Namule007, eb03Viola030, op04CorridaColiseum096],
        activeDon: 4,
        // Non-Dressrosa draws, so the two cards drawn cannot themselves become play candidates.
        deck: [op02Atmos003, op02Atmos003, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const blueGillyId = engine.findCardInZone("south", "hand", op10BlueGilly054);
    const wrongTraitId = engine.findCardInZone("south", "hand", op03Namule007);
    const wrongCostId = engine.findCardInZone("south", "hand", eb03Viola030);
    const wrongCategoryId = engine.findCardInZone("south", "hand", op04CorridaColiseum096);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "0" }, "south");

    // Draw 2 is what `amount 2->1` used to survive: trash-one-Atmos still works at 1. After the
    // Event leaves hand (5 -> 4) the two draws must leave 6 in hand and 1 in a 3-card deck.
    expect(engine.getState().players.south.hand).toHaveLength(6);
    expect(engine.getState().players.south.deck).toHaveLength(1);

    // Draw 2, then trash 1 -- one of the drawn Atmos copies, so the counterexamples stay in hand.
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [engine.findCardInZone("south", "hand", op02Atmos003)] },
      "south",
    );

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected the hand-play choice.");
    const candidateIds = play.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([blueGillyId]);
    expect(candidateIds).not.toContain(wrongTraitId);
    expect(candidateIds).not.toContain(wrongCostId);
    expect(candidateIds).not.toContain(wrongCategoryId);
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
