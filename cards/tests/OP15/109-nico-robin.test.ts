import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op05Enel098,
  op05UpperYard117,
  op12Seto103,
  op12Wyper114,
  op15MonkeyDLuffy098,
  op15NicoRobin109,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op15MonkeyDLuffy098 is the [Sky Island][Straw Hat Crew] Leader; op05Enel098 is [Sky Island] only
// and is the negative. Hand fixtures for the play half:
//   op12Seto103       [Sky Island] Character, cost 5 -- exactly on the line
//   op12Wyper114      [Sky Island] Character, cost 6 -- one over
//   op05UpperYard117  [Sky Island] STAGE,     cost 1 -- cheap, right trait, wrong card type
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function robinOnPlay(leaderCardId: PlayerFixture["leaderCardId"], life = 3) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op15NicoRobin109, op12Seto103, op12Wyper114, op05UpperYard117],
      life,
      deck: [op01Sai012, op01Sai012, op01Sai012],
      activeDon: 7,
    },
    {},
    SOUTH_ACTS,
  );
}

describe("OP15-109 Nico Robin", () => {
  test("[On Play] banks a Life card, refills Life from the deck and plays a cost-5 [Sky Island] Character", () => {
    const engine = robinOnPlay(op15MonkeyDLuffy098);
    const setoId = engine.findCardInZone("south", "hand", op12Seto103);
    const wyperId = engine.findCardInZone("south", "hand", op12Wyper114);
    const upperYardId = engine.findCardInZone("south", "hand", op05UpperYard117);
    const deckTopId = engine.getState().players.south.deck[0];

    engine.playCard(op15NicoRobin109, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    // The cost took the top Life card into hand: 3 -> 2.
    expect(engine.getState().players.south.life).toHaveLength(2);

    engine.resolveDecision("effectAddToLifeFromDeck", { optionId: "1" }, "south");
    const state = engine.getState();
    expect(state.players.south.life).toHaveLength(3);
    expect(state.players.south.life[0]).toBe(deckTopId);

    const selection = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a play selection.");
    // Cost 5 exactly is in; cost 6 is out; the cost-1 [Sky Island] Stage is out because the card
    // prints "Character card".
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([setoId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(wyperId);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(upperYardId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [setoId] }, "south");
    expect(engine.getState().cards[setoId]?.zone).toBe("character");
  });

  test("without a [Straw Hat Crew] Leader the cost is still paid and NEITHER half happens", () => {
    // The placement assertion. The Leader check sits after the cost colon, so it gates the
    // payload only: move it up to the block's `conditions` and the Life card would stop being
    // spent, which is what the first two expectations here pin. And it covers the "Then," half
    // too (ruling #944's shape on OP15-116): move it down onto the `addToLife` action alone and
    // the play offer would still appear, which is what the last expectation pins.
    const engine = robinOnPlay(op05Enel098);

    engine.playCard(op15NicoRobin109, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const state = engine.getState();
    expect(state.players.south.life).toHaveLength(2);
    expect(state.players.south.hand.length).toBeGreaterThan(0);
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(
      state.players.south.characterArea.filter((entry): entry is string => entry !== null),
    ).toHaveLength(1);
  });

  test("ruling #940: at 0 Life cards neither half can be performed", () => {
    // 不可以 -- and it falls out of the cost, not a condition: `canPayCosts` rejects
    // `addLifeToHand` against an empty Life area, so the confirm is never published.
    const engine = robinOnPlay(op15MonkeyDLuffy098, 0);

    engine.playCard(op15NicoRobin109, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.life).toHaveLength(0);
    expect(
      engine
        .getState()
        .players.south.characterArea.filter((entry): entry is string => entry !== null),
    ).toHaveLength(1);
  });

  test("declining the cost skips everything", () => {
    const engine = robinOnPlay(op15MonkeyDLuffy098);

    engine.playCard(op15NicoRobin109, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().players.south.life).toHaveLength(3);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
