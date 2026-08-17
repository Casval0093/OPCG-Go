import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op01Sai012,
  op02Atmos003,
  op02Kingdew006,
  op03Namule007,
  op05Enel098,
  op08Kalgara098,
  op12Seto103,
  op12Wyper114,
  op15GanFall102,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A [Sky Island] LEADER with 7000 power. No such Leader is printed -- every real Sky Island
// Leader is 5000 -- but the encoding scopes the enabler to `zone: "character"` because the card
// prints "a [Sky Island] type CHARACTER", and this is what proves that scoping is load-bearing
// rather than an accident. Switch the condition to `zone: "field"` and the discount would fire
// off this Leader alone.
const skyIslandLeader7000: LeaderCard = {
  ...op08Kalgara098,
  id: "TEST-OP15-102-SKY-ISLAND-LEADER",
  canonicalId: "TEST-OP15-102-SKY-ISLAND-LEADER",
  power: 7000,
};

registerCards([skyIslandLeader7000]);

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function ganFallInHand(
  enabler: PlayerFixture["character"],
  activeDon: number,
  leaderCardId: PlayerFixture["leaderCardId"] = op05Enel098,
) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op15GanFall102], character: enabler, activeDon },
    {},
    SOUTH_ACTS,
  );
}

describe("OP15-102 Gan.Fall", () => {
  test("a 7000-power [Sky Island] Character makes the cost-4 body playable for 1 DON!!", () => {
    const engine = ganFallInHand([{ card: op12Wyper114, playedOnTurn: 0 }], 1);

    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(1);
    expect(engine.playCard(op15GanFall102, "south").accepted).toBe(true);
  });

  test("a 6000-power [Sky Island] Character is under the line and buys nothing", () => {
    // op12Seto103 is 6000 base -- one step below the printed 7000. At `gte 6000` this would
    // become playable and the test goes red.
    const engine = ganFallInHand([{ card: op12Seto103, playedOnTurn: 0 }], 3);

    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(4);
    expect(
      engine.expectFailure({
        type: "playCard",
        seat: "south",
        instanceId: engine.findCardInZone("south", "hand", op15GanFall102),
      }).accepted,
    ).toBe(false);
  });

  test("attached DON!! carries a 6000-base body over the line -- the filter is `power`, not `basePower`", () => {
    // The discriminator the mutation checker cannot generate: `power` and `basePower` agree on
    // every unmodified board. Seto is 6000 printed; one attached DON!! makes its current power
    // 7000 while its base stays 6000, so only the `power` reading fires the discount.
    const engine = ganFallInHand([{ card: op12Seto103, playedOnTurn: 0 }], 2);
    const setoId = engine.findCardInZone("south", "character", op12Seto103);

    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(4);
    engine.attachDon(setoId, 1, "south");

    expect(engine.getView("south").players.south.characters[0]?.power ?? null).toBe(7000);
    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(1);
  });

  test("a 7000-power Character without the [Sky Island] type does not enable the discount", () => {
    const engine = ganFallInHand([{ card: op02Kingdew006, playedOnTurn: 0 }], 3);

    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(4);
  });

  test('a 7000-power [Sky Island] LEADER does not enable it -- the card prints "Character"', () => {
    const engine = ganFallInHand([], 3, skyIslandLeader7000);

    expect(engine.getView("south").players.south.leader.power).toBe(7000);
    expect(engine.getView("south").players.south.hand[0]?.cost).toBe(4);
  });

  test("[On Play] rests an opponent Character whose cost is within their Life count", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15GanFall102], activeDon: 4 },
      {
        life: 3,
        character: [
          { card: op03Namule007, playedOnTurn: 0 },
          { card: op02Atmos003, playedOnTurn: 0 },
        ],
      },
      SOUTH_ACTS,
    );
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op15GanFall102, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a rest target selection.");
    // 3 Life -> cost 3 is exactly on the line and legal; cost 4 is not.
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([namuleId]);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");
    expect(engine.getState().cards[namuleId]?.rested).toBe(true);
    expect(engine.getState().cards[atmosId]?.rested).toBe(false);
  });

  test("the reference count is the OPPONENT's Life, not your own", () => {
    const engine = OnePieceTestEngine.create(
      // South is on 2 Life and north on 5. Under `selfLifeCount` neither cost-3 nor cost-4 body
      // would be legal and no prompt would appear at all; under `opponentLifeCount` both are.
      { leaderCardId: op05Enel098, hand: [op15GanFall102], life: 2, activeDon: 4 },
      {
        life: 5,
        character: [
          { card: op03Namule007, playedOnTurn: 0 },
          { card: op02Atmos003, playedOnTurn: 0 },
        ],
      },
      SOUTH_ACTS,
    );
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.playCard(op15GanFall102, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a rest target selection.");
    expect(selection.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [namuleId, atmosId].sort(),
    );
  });

  test("with the opponent at 1 Life nothing is cheap enough and no prompt appears", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15GanFall102], activeDon: 4 },
      { life: 1, character: [{ card: op01Sai012, playedOnTurn: 0 }] },
      SOUTH_ACTS,
    );
    const saiId = engine.findCardInZone("north", "character", op01Sai012);

    engine.playCard(op15GanFall102, "south");

    // GENERAL ruling #27 / the `upTo` rule: zero legal candidates means no prompt at all.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[saiId]?.rested).toBe(false);
  });
});
