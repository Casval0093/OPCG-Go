import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op02Thatch007, op10BlueGilly054, op15Orlumbus041 } from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

function orlumbusInHand() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      hand: [op15Orlumbus041],
      character: [{ card: op10BlueGilly054, playedOnTurn: 0 }],
      // 4, not 3: one DON!! is left over after paying for Orlumbus so it can be attached to him.
      // At a printed 4000 he cannot beat a 5000 Leader, and "the attack was legal" is a much
      // weaker witness for [Rush] than "the attack connected".
      activeDon: 4,
    },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-041 Orlumbus", () => {
  test("[On K.O.] draws 1", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, character: [{ card: op15Orlumbus041, rested: true }] },
      { leaderCardId: op02Smoker093, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const orlumbusId = engine.findCardInZone("south", "character", op15Orlumbus041);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.declareAttack(thatchId, orlumbusId, "north");

    const state = engine.getState();
    expect(state.cards[orlumbusId]?.zone).toBe("trash");
    // Assert the DECK, not the hand: a Leader taking damage also moves a Life card into its
    // controller's hand, so hand length is not a clean witness for a draw.
    expect(state.players.south.deck).toHaveLength(deckBefore - 1);
    expect(state.players.south.hand).toHaveLength(1);
  });

  test("[Activate: Main] bottoms a Character to give itself [Rush], once per turn", () => {
    const engine = orlumbusInHand();
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op15Orlumbus041, "south");
    const orlumbusId = engine.findCardInZone("south", "character", op15Orlumbus041);
    engine.attachDon(orlumbusId, 1, "south");

    engine.activateEffect(orlumbusId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostReturnCharacterToDeck", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Orlumbus's Character-to-deck cost.");
    // Ruling #894: Orlumbus himself is a legal payment. No `excludeSelf` -- contrast OP05-056
    // X Barrels, whose printed text adds "other than this Character".
    expect(cost.candidates.map((candidate) => candidate.ref.id)).toEqual([blueGillyId, orlumbusId]);
    engine.resolveDecision(
      "effectCostReturnCharacterToDeck",
      { selectedIds: [blueGillyId] },
      "south",
    );

    expect(engine.getState().players.south.deck.at(-1)).toBe(blueGillyId);

    // [Rush]: a Character played this turn attacking the same turn. 4000 + 1 attached DON!!
    // meets the 5000 Leader, so the attack connects rather than merely being legal.
    engine.declareAttack(orlumbusId, engine.leader("north"), "south");
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);

    // [Once Per Turn]: a second activation is no longer offered, even though Orlumbus is still on
    // the field and the cost is still payable (he can always pay it himself).
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === orlumbusId,
      ),
    ).toBe(false);
  });

  test("without the activation the freshly played Orlumbus cannot attack", () => {
    // The control for [Rush]. A granted keyword has no projected field, so the proof that the
    // grant did anything is that the identical attack is illegal without it.
    const engine = orlumbusInHand();

    engine.playCard(op15Orlumbus041, "south");
    const orlumbusId = engine.findCardInZone("south", "character", op15Orlumbus041);

    const rejection = engine.expectFailure({
      type: "declareAttack",
      seat: "south",
      attackerId: orlumbusId,
      targetId: engine.leader("north"),
    });
    expect(rejection.reason).toBe("The selected attacker cannot attack.");
  });

  test("ruling #894: paying with Orlumbus himself is legal, and then nothing happens", () => {
    // 可以 -- and the grant "什么都不会发生", because the card it would have targeted is no longer
    // on the field. This is the whole reason the cost carries no `excludeSelf`.
    const engine = orlumbusInHand();
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);

    engine.playCard(op15Orlumbus041, "south");
    const orlumbusId = engine.findCardInZone("south", "character", op15Orlumbus041);

    engine.activateEffect(orlumbusId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectCostReturnCharacterToDeck",
      { selectedIds: [orlumbusId] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[orlumbusId]?.zone).toBe("deck");
    expect(state.players.south.deck.at(-1)).toBe(orlumbusId);
    expect(state.players.south.characterArea).toContain(blueGillyId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test('"You may" is a real choice -- declining costs nothing', () => {
    const engine = orlumbusInHand();
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const deckBefore = engine.getState().players.south.deck.length;

    engine.playCard(op15Orlumbus041, "south");
    const orlumbusId = engine.findCardInZone("south", "character", op15Orlumbus041);

    engine.activateEffect(orlumbusId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south.deck).toHaveLength(deckBefore);
    expect(state.players.south.characterArea).toContain(blueGillyId);
    expect(state.players.south.characterArea).toContain(orlumbusId);
  });
});
