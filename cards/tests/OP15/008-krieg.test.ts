import { describe, expect, test } from "vite-plus/test";
import { eb01Doma005, op02Smoker093, op15Krieg008 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the "Then, this Character gains [Rush] during this turn" half of the [On Play] is encoded;
// the DON!!-giving half and the whole [Activate: Main] are parked (see the card file). Ruling #858
// is what makes encoding the grant on its own faithful rather than a liberty: the [Rush] is gained
// even when the [On Play] gives NO DON!! at all (可以), so it does not depend on the parked half.
//
// A granted keyword has no projected field, so it is proved functionally, and the mutation checker
// generates nothing at all for this card (no filters, no comparisons, no `value:`) -- everything
// below is hand-written.

describe("OP15-008 Krieg", () => {
  test("[On Play] the granted [Rush] lets Krieg attack the turn it is played", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, hand: [op15Krieg008], activeDon: 10 },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op15Krieg008, "south");
    const kriegId = engine.findCardInZone("south", "character", op15Krieg008);
    engine.declareAttack(kriegId, engine.leader("north"), "south");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });

  test("the control: a Character played the same turn without [Rush] cannot attack", () => {
    // Without this pair, "Krieg attacked" would not distinguish the grant from a fixture that
    // simply lets anything attack. Same seat, same turn, same DON!!.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, hand: [eb01Doma005], activeDon: 10 },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(eb01Doma005, "south");
    const domaId = engine.findCardInZone("south", "character", eb01Doma005);

    const rejection = engine.expectFailure({
      type: "declareAttack",
      seat: "south",
      attackerId: domaId,
      targetId: engine.leader("north"),
    });
    expect(rejection.reason).toBe("The selected attacker cannot attack.");
  });

  test("the grant is scoped to Krieg -- a body already on the field gains nothing", () => {
    // `self: true` on the grant's target: playing Krieg must not hand [Rush] to the OTHER
    // Character played alongside it on the same turn. Widen the target away from `self` and this
    // goes green for the wrong reason.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15Krieg008, eb01Doma005],
        activeDon: 10,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(eb01Doma005, "south");
    engine.playCard(op15Krieg008, "south");
    const domaId = engine.findCardInZone("south", "character", eb01Doma005);

    const rejection = engine.expectFailure({
      type: "declareAttack",
      seat: "south",
      attackerId: domaId,
      targetId: engine.leader("north"),
    });
    expect(rejection.reason).toBe("The selected attacker cannot attack.");
  });
});
