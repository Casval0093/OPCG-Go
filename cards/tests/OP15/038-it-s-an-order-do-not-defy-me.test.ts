import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
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
