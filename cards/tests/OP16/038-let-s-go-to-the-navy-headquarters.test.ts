import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Kingdew006,
  op16LetSGoToTheNavyHeadquarters038,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [Counter] half of this card is encoded; the [Main] is parked on a missing
// distinct-card-name Condition (see the PARKED note on the card itself), so there is nothing to
// test on that side and no `main` block for `playCard` to find.

describe("OP16-038 Let's Go!! To the Navy Headquarters!!", () => {
  test("[Counter] +3000 holds a 7000-power attack off the Leader", () => {
    // Ace's Leader is 5000 base; +3000 = 8000 against a 7000 attacker, so no Life is lost.
    // Mutated to +2000 the Leader sits at 7000 and `attackPower >= defensePower` connects. This is
    // the only way the magnitude is observable: a `thisBattle` modifier on the attacked Leader has
    // already expired by the time control returns to the test (cards/ENCODING.md).
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16LetSGoToTheNavyHeadquarters038, eb01Doma005],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const eventId = engine.findCardInZone("north", "hand", op16LetSGoToTheNavyHeadquarters038);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
    expect(view.prompts).toHaveLength(0);
  });

  test("without the [Counter] the same attack takes a Life card", () => {
    // The control case, and the reason the test above is not vacuous: nothing else about this
    // fixture stops a 7000-power attack against a 5000-power Leader.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16LetSGoToTheNavyHeadquarters038, eb01Doma005],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });
});
