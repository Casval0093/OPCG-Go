import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op10Sugar003,
  op13MonkeyDLuffy001,
  op16TrafalgarLaw068,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// op10Sugar003 has the [Donquixote Pirates] type. Its own [End of Your Turn] needs a
// {Donquixote Pirates} Character with 6000 power or more -- Law is a 3000 body and no turn is
// ended while he is boosted, so it never fires here.
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function lawAttacking(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    { leaderCardId, character: [{ card: op16TrafalgarLaw068, playedOnTurn: 0 }] },
    // 6000 power and rested, so it is both a legal attack target and exactly on the line: at
    // 3000 + 3000 the attack connects (attackPower >= defensePower); at +2000 it does not.
    { character: [{ card: op02Atmos003, rested: true }] },
    SOUTH_ATTACKS,
  );
}

describe("OP16-068 Trafalgar Law", () => {
  test("[On Play] adds up to 1 DON!! from the DON!! deck ACTIVE", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op10Sugar003,
        hand: [op16TrafalgarLaw068],
        activeDon: op16TrafalgarLaw068.cost,
        donDeckCount: 5,
      },
      {},
    );

    engine.playCard(op16TrafalgarLaw068, "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected Law's DON!! count choice.");
    // Capped at 1 by "up to 1", not by the 5 in the DON!! deck: this is what pins `amount: 1`.
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectAddDon", { optionId: "1" }, "south");

    const view = engine.getView("south");
    // The 4 spent on Law are rested; the added one is ACTIVE.
    expect(view.players.south).toMatchObject({ activeDon: 1, restedDon: 4, donDeckCount: 4 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[When Attacking] with a [Donquixote Pirates] Leader, +3000 turns a 3000 body into 6000", () => {
    const engine = lawAttacking(op10Sugar003);
    const lawId = engine.findCardInZone("south", "character", op16TrafalgarLaw068);
    const defenderId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(lawId, defenderId, "south");

    const power = () =>
      engine.getView("south").players.south.characters.find((c) => c?.instanceId === lawId)?.power;
    // A `thisTurn` modifier is readable straight off the projection, so the magnitude is asserted
    // as an exact number as well as through the battle result below.
    expect(power()).toBe(6000);
    expect(engine.getState().cards[defenderId]?.zone).toBe("trash");

    // "during this turn": gone once the turn ends.
    engine.endTurn("south");
    expect(power()).toBe(3000);
  });

  test("[When Attacking] without the type there is no boost and the same attack bounces off", () => {
    const engine = lawAttacking(op13MonkeyDLuffy001);
    const lawId = engine.findCardInZone("south", "character", op16TrafalgarLaw068);
    const defenderId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(lawId, defenderId, "south");

    expect(
      engine.getView("south").players.south.characters.find((c) => c?.instanceId === lawId)?.power,
    ).toBe(3000);
    expect(engine.getState().cards[defenderId]?.zone).toBe("character");
  });
});
