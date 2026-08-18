import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op03Namule007,
  op13MonkeyDLuffy001,
  op16MobyDick021,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op16PortgasDAce001 is the Whitebeard Pirates Leader (its only ability is an [Activate: Main], so
// it never fires on its own); op13MonkeyDLuffy001 is "Straw Hat Crew Supernovas" and its only
// ability is an [On Your Opponent's Attack], inert on your own turn -- so it is a clean stand-in
// for "a Leader without the type". All three deck cards are genuinely vanilla.

describe("OP16-021 Moby Dick", () => {
  test("[On Play] with a Whitebeard Pirates Leader: look at 3, take 1, rest to the deck bottom", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16MobyDick021],
        deck: [op03Namule007, op02Atmos003, eb01Doma005, op03Namule007, op02Atmos003],
        activeDon: 1,
      },
      {},
    );
    const [firstId, secondId, thirdId, fourthId, fifthId] = engine.getState().players.south
      .deck as [string, string, string, string, string];

    engine.playCard(op16MobyDick021, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(look?.kind).toBe("selectEntity");
    if (look?.kind !== "selectEntity") throw new Error("Expected Moby Dick's look-at-3.");
    // Exactly the top 3, and all three are legal: "add up to 1 card" carries no restriction, so
    // the 4th card of the deck being absent is the only thing lookCount decides here.
    expect(look.candidates.map((candidate) => candidate.ref.id)).toEqual([
      firstId,
      secondId,
      thirdId,
    ]);
    engine.resolveDecision("effectSearchSelection", { selectedIds: [secondId] }, "south");

    // 2 remaining cards means a real ordering prompt (1 or fewer would auto-place).
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [thirdId, firstId] },
      "south",
    );

    const state = engine.getState();
    expect(state.players.south.hand).toContain(secondId);
    // The chosen order lands at the BOTTOM, behind the two cards the search never looked at.
    expect(state.players.south.deck).toEqual([fourthId, fifthId, thirdId, firstId]);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[On Play] does nothing without a Whitebeard Pirates Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op13MonkeyDLuffy001,
        hand: [op16MobyDick021],
        deck: [op03Namule007, op02Atmos003, eb01Doma005, op03Namule007],
        activeDon: 1,
      },
      {},
    );
    const deckBefore = [...engine.getState().players.south.deck];

    engine.playCard(op16MobyDick021, "south");

    // No look, no hand addition, and the Stage is still placed: the condition gates the ability,
    // not the ability to play the card.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.deck).toEqual(deckBefore);
    expect(engine.getState().players.south.stageArea).not.toBeNull();
  });

  test("[Activate: Main] trashes the Stage to give 1 rested DON!! to the Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        stage: op16MobyDick021,
        character: [op03Namule007],
        activeDon: 0,
        restedDon: 2,
      },
      {},
    );
    const stageId = engine.findCardInZone("south", "stage", op16MobyDick021);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.activateEffect(stageId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // An `upTo` DON!! grant asks how many first (`effectGiveDonCount`), and only then who gets it.
    const howMany = engine.pendingDecision("effectGiveDonCount", "south").steps[0];
    expect(howMany?.kind).toBe("chooseOption");
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // Capped at 1 by "up to 1", not at 2 by the rested DON!! available.
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    // "to your Leader or 1 of your Characters" -- both zones are offered.
    const recipient = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (recipient?.kind !== "selectEntity") throw new Error("Expected the DON!! recipient choice.");
    expect(recipient.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("south"), namuleId].sort(),
    );
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    const state = engine.getState();
    // A RESTED DON!! card, so the rested pool is what shrinks; the active pool was 0 throughout
    // and an `donState: "active"` encoding could not have paid at all.
    expect(state.players.south.restedDon).toBe(1);
    expect(state.players.south.activeDon).toBe(0);
    expect(state.cards[engine.leader("south")]?.attachedDon).toBe(1);
    // The cost really is trashing the Stage.
    expect(state.players.south.stageArea).toBeNull();
    expect(state.players.south.trash).toContain(stageId);
  });
});
