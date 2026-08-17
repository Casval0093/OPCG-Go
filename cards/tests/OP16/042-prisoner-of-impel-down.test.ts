import { describe, expect, test } from "vite-plus/test";
import { op16PrisonerOfImpelDown042 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-042 Prisoner of Impel Down", () => {
  // `deckBuildingRules` is declarative: nothing under packages/engine/src reads it, so there is
  // no in-game behaviour to drive. The upstream precedent for asserting one is
  // engine/tests/cards/leaders/op12-001-silvers-rayleigh.test.ts, which checks the card
  // definition directly for exactly this reason.
  test("declares the unlimited-copies deck-construction rule", () => {
    expect(op16PrisonerOfImpelDown042.effects?.deckBuildingRules).toEqual([
      { rule: "unlimitedCopies" },
    ]);
  });

  // The other half of the claim this encoding makes is a negative one: the printed text is
  // *entirely* a deck rule, so the card must behave as a vanilla 6/6000 body. This is what
  // OP16-057 Captain Buggy's Our Savior!! and OP16-048 Buggy depend on when they count
  // "[Prisoner of Impel Down]" cards by name -- if an effect were bolted onto this card, those
  // name counts would start dragging extra resolutions in with them.
  test("is otherwise inert: a 4th copy hits the field with no prompt and no capability issue", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16PrisonerOfImpelDown042],
        character: [
          op16PrisonerOfImpelDown042,
          op16PrisonerOfImpelDown042,
          op16PrisonerOfImpelDown042,
        ],
        activeDon: 6,
      },
      {},
    );

    engine.playCard(op16PrisonerOfImpelDown042, "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(
      view.players.south.characters.filter(
        (card) => card?.cardId === op16PrisonerOfImpelDown042.id,
      ),
    ).toHaveLength(4);
    expect(engine.getState().capabilityHistory).toHaveLength(0);
    expect(op16PrisonerOfImpelDown042.effects?.effects).toBeUndefined();
    expect(op16PrisonerOfImpelDown042.effects?.keywords).toBeUndefined();
    expect(op16PrisonerOfImpelDown042.effects?.permanentEffects).toBeUndefined();
  });
});
