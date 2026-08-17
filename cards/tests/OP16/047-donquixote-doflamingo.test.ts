import { describe, expect, test } from "vite-plus/test";
import { eb01Doma005, op02Atmos003, op16DonquixoteDoflamingo047 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function handOf(count: number) {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? eb01Doma005 : op02Atmos003,
  );
}

describe("OP16-047 Donquixote Doflamingo", () => {
  test("ruling #990: the OPPONENT picks which 2 hand cards go to the bottom, and in what order", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16DonquixoteDoflamingo047, playedOnTurn: 0 }] },
      { hand: handOf(10) },
    );
    const doflamingoId = engine.findCardInZone("south", "character", op16DonquixoteDoflamingo047);
    const northHandBefore = [...engine.getState().players.north.hand];
    const northDeckBefore = engine.getView("north").players.north.deckCount;

    engine.activateEffect(doflamingoId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // `chosenBy: "opponent"` is what puts this prompt on north's queue. pendingDecision throws
    // when the intent is not pending for the named seat, so asking north for it IS the
    // assertion that the selection did not go to Doflamingo's controller.
    const selection = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(selection).toMatchObject({ kind: "selectEntity", min: 2, max: 2 });
    if (selection?.kind !== "selectEntity") throw new Error("Expected the opponent's hand choice.");
    expect(selection.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...northHandBefore].sort(),
    );
    // Pick out of order on purpose: hand[5] before hand[2]. When the cards all come from ONE
    // player's hand and that player is also the chooser, the engine takes the SELECTION order as
    // the placement order and publishes no separate ordering step
    // (`selectionAlreadyProvidesOwnerOrder`, effects/actions.ts) -- so this is where "in any
    // order" is actually exercised.
    const [firstId, secondId] = [northHandBefore[5]!, northHandBefore[2]!];
    engine.resolveDecision("effectTargetSelection", { selectedIds: [firstId, secondId] }, "north");

    const state = engine.getState();
    expect(state.players.north.hand).toHaveLength(8);
    expect(state.players.north.hand).not.toContain(firstId);
    expect(state.players.north.hand).not.toContain(secondId);
    // "at the bottom of their deck" -- bottom is the tail of the deck array
    // (effects/actions.ts consistently treats `position: "bottom"` as `slice(-n)`), and the
    // order is the one the OWNER chose, not the order they were selected in.
    expect(state.players.north.deck.slice(-2)).toEqual([firstId, secondId]);
    expect(engine.getView("north").players.north.deckCount).toBe(northDeckBefore + 2);
    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === doflamingoId)?.rested,
    ).toBe(true);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test('"8 or more" fires at exactly 8', () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16DonquixoteDoflamingo047, playedOnTurn: 0 }] },
      { hand: handOf(8) },
    );
    const doflamingoId = engine.findCardInZone("south", "character", op16DonquixoteDoflamingo047);

    engine.activateEffect(doflamingoId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // `value: 8` is a single digit, so mutation_check.py generates no numeric mutant for it
    // (cards/ENCODING.md, rule 0). This case and the 7-card case below pin it by hand: at 8 the
    // effect is available, at 7 it is refused.
    expect(engine.pendingDecision("effectTargetSelection", "north").steps[0]?.kind).toBe(
      "selectEntity",
    );
  });

  test("at 7 cards the activation is refused outright", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16DonquixoteDoflamingo047, playedOnTurn: 0 }] },
      { hand: handOf(7) },
    );
    const doflamingoId = engine.findCardInZone("south", "character", op16DonquixoteDoflamingo047);

    // This is also what kills the gte->lte mutant: under "7 or fewer" this activation would be
    // accepted and the opponent would be milled.
    const result = engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: doflamingoId,
      trigger: "activateMain",
    });
    expect(result.reason).toBe("The activation conditions are not met.");
    expect(engine.getState().players.north.hand).toHaveLength(7);
    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === doflamingoId)?.rested,
    ).toBe(false);
  });
});
