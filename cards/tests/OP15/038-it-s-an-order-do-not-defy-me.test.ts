import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Thatch007,
  op10BlueGilly054,
  op15ItSAnOrderDoNotDefyMe038,
  op15Krieg001,
  op15Krieg008,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Only the [Counter] half of this Event is encoded. The [Main] clause is parked -- it needs a filter
// over a candidate's attached DON!! count, which no TargetFilter provides (see the card file and
// cards/ENCODING.md). Nothing here should be read as covering it.

describe("OP15-038 It's an Order! Do Not Defy Me!!!", () => {
  test("[Counter] gives exactly +4000 -- enough to survive an 8000 attacker, which +3000 would not be", () => {
    // The MAGNITUDE, not just the target. Asserting the candidate list leaves `value` free: a
    // mutation from +4000 to +3000 survives every list-shaped assertion. The attacker is pitched at
    // exactly the defender's power + 3000 so the two values give opposite outcomes -- `attackPower >=
    // defensePower` is a hit, so at +3000 this connects and at +4000 it does not.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { leaderCardId: op15Krieg001, hand: [op15ItSAnOrderDoNotDefyMe038], activeDon: 1 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Thatch007);
    const counterId = engine.findCardInZone("north", "hand", op15ItSAnOrderDoNotDefyMe038);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );

    // Thatch 8000 vs the Krieg Leader at 5000 + 4000 = 9000.
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });

  test("[Counter] gives +4000 to a [Krieg] card, and only to a [Krieg] card", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op10BlueGilly054, playedOnTurn: 0 }] },
      {
        // North's Leader is also Krieg here so the Leader is a name match too -- "your [Krieg] cards"
        // is not restricted to Characters, which is why the target zones are ["leader", "character"].
        leaderCardId: op15Krieg001,
        hand: [op15ItSAnOrderDoNotDefyMe038],
        activeDon: 1,
        character: [op15Krieg008, op02Atmos003],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const counterId = engine.findCardInZone("north", "hand", op15ItSAnOrderDoNotDefyMe038);
    const kriegCharacterId = engine.findCardInZone("north", "character", op15Krieg008);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [counterId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(boost?.kind).toBe("selectEntity");
    if (boost?.kind !== "selectEntity") throw new Error("Expected the [Krieg] boost target.");
    const candidateIds = boost.candidates.map((candidate) => candidate.ref.id);
    // The Leader (named Krieg) and the Krieg Character qualify; Blue Gilly's opposite number Atmos
    // does not. Drop the `name` filter and Atmos joins the list, so this goes red.
    expect(candidateIds).toContain(engine.leader("north"));
    expect(candidateIds).toContain(kriegCharacterId);
    expect(candidateIds).not.toContain(atmosId);
  });
});
