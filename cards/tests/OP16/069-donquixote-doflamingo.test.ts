import { describe, expect, test } from "vite-plus/test";
import { op16DonquixoteDoflamingo069 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The default Leader (OP13-001) is used throughout: this card prints no Leader condition, and
// OP13-001's own ability is [DON!! x1] [On Your Opponent's Attack], which cannot fire on south's
// own turn.
describe("OP16-069 Donquixote Doflamingo", () => {
  test("[On Play] adds up to 1 DON!! from the DON!! deck ACTIVE", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16DonquixoteDoflamingo069],
        activeDon: op16DonquixoteDoflamingo069.cost,
        donDeckCount: 5,
      },
      {},
    );

    engine.playCard(op16DonquixoteDoflamingo069, "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // Capped at 1 by "up to 1", not by the DON!! deck.
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 1, restedDon: 7, donDeckCount: 4 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[When Attacking] fires the same effect for a body already on the field", () => {
    // "[On Play]/[When Attacking]" is two independent blocks. This test only reaches the second
    // one -- Doflamingo is placed on the field rather than played, so no [On Play] ever ran, and
    // the DON!! that arrives here can only have come from the attack trigger.
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16DonquixoteDoflamingo069, playedOnTurn: 0 }],
        donDeckCount: 5,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const doflamingoId = engine.findCardInZone("south", "character", op16DonquixoteDoflamingo069);

    engine.declareAttack(doflamingoId, engine.leader("north"), "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 1, restedDon: 0, donDeckCount: 4 });
    // The attack still resolved: an 8000 body into a 5000 Leader takes a Life card.
    expect(view.players.north.lifeCount).toBe(3);
  });

  test("adding 0 is a legal answer and leaves the DON!! deck alone", () => {
    const engine = OnePieceTestEngine.create(
      {
        hand: [op16DonquixoteDoflamingo069],
        activeDon: op16DonquixoteDoflamingo069.cost,
        donDeckCount: 5,
      },
      {},
    );

    engine.playCard(op16DonquixoteDoflamingo069, "south");
    engine.resolveDecision("effectAddDon", { optionId: "0" }, "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 7, donDeckCount: 5 });
    expect(view.prompts).toHaveLength(0);
  });
});
