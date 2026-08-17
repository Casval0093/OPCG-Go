import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Kingdew006,
  op16HallowedGlacierSlash100,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Only the [Counter] half of this card is encoded; the [Main] is parked on a missing
// "an opponent Character was K.O.'d this turn" Condition (see the PARKED note on the card itself),
// so there is no `main` block for `playCard` to find and nothing to assert on that side.

function attackTheLeader(northHand: PlayerFixture["hand"]) {
  const engine = OnePieceTestEngine.create(
    { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
    { leaderCardId: op16PortgasDAce001, hand: northHand, activeDon: 1 },
    { firstPlayer: "north", activeSeat: "south" },
  );
  engine.declareAttack(
    engine.findCardInZone("south", "character", op02Kingdew006),
    engine.leader("north"),
    "south",
  );
  return engine;
}

describe("OP16-100 Hallowed Glacier Slash", () => {
  test("[Counter] +3000 holds a 7000-power attack off the Leader", () => {
    // Ace's Leader is 5000 base; +3000 = 8000 against 7000, so no Life is lost. Mutated to +2000 it
    // sits at exactly 7000 and `attackPower >= defensePower` connects. A `thisBattle` modifier on
    // the attacked Leader has already expired by the time control returns here, so a battle outcome
    // is the only way the magnitude is observable (cards/ENCODING.md).
    const engine = attackTheLeader([op16HallowedGlacierSlash100, eb01Doma005]);
    const eventId = engine.findCardInZone("north", "hand", op16HallowedGlacierSlash100);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
    expect(view.prompts).toHaveLength(0);
  });

  test("without the [Counter] the same attack takes a Life card", () => {
    const engine = attackTheLeader([op16HallowedGlacierSlash100, eb01Doma005]);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 1);
  });
});
