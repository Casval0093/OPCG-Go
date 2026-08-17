import { describe, expect, test } from "vite-plus/test";
import {
  op02MonkeyDLuffy041,
  op04MonkeyDLuffy014,
  op16Jozu007,
  op16Namule010,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-001 Portgas.D.Ace", () => {
  test("ruling #961: a Whitebeard Pirates Character at 2000 power cannot gain Rush, only one at 8000+", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op16Namule010, op16Jozu007],
      },
      {},
    );
    const namuleId = engine.findCardInZone("south", "character", op16Namule010);
    const jozuId = engine.findCardInZone("south", "character", op16Jozu007);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Ace's Rush recipient.");
    // Namule is Whitebeard Pirates at 2000 power -- well under the 8000 threshold ruling
    // #961 confirms applies to this clause. A wrong reading that only gated the Luffy
    // clause on power would leave the Whitebeard clause's own boundary unaffected (this
    // assertion would pass either way); the test that would actually fail under that wrong
    // reading is the Luffy-clause test below.
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([jozuId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
  });

  test('ruling #961 binds "8000 power or more" to the [Monkey.D.Luffy] clause too, and the grant lets a same-turn Luffy attack', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op04MonkeyDLuffy014],
        character: [op02MonkeyDLuffy041],
        activeDon: op04MonkeyDLuffy014.cost,
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    // op02MonkeyDLuffy041 is named "Monkey.D.Luffy" at 7000 power -- under the printed
    // English text's most natural (wrong) reading, "with 8000 power or more" reads as
    // modifying only the trailing Whitebeard Pirates clause, so an unqualified
    // [Monkey.D.Luffy] Character would still be a legal target here. Ruling #961 says it is
    // not: the power qualifier binds to BOTH clauses. This card must NOT appear as a
    // candidate below, or the test is passing under the wrong reading.
    const lowPowerLuffyId = engine.findCardInZone("south", "character", op02MonkeyDLuffy041);

    engine.playCard(op04MonkeyDLuffy014, "south");
    const highPowerLuffyId = engine.findCardInZone("south", "character", op04MonkeyDLuffy014);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");
    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Ace's Rush recipient.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([highPowerLuffyId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      lowPowerLuffyId,
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [highPowerLuffyId] }, "south");

    // Functional proof, not just a candidate-list check: op04MonkeyDLuffy014 was played this
    // turn and has no printed [Rush], so it could only attack now because Ace's grant took
    // effect.
    engine.declareAttack(highPowerLuffyId, engine.leader("north"), "south");

    expect(
      engine
        .getView("south")
        .players.south.characters.find((card) => card?.instanceId === highPowerLuffyId)?.rested,
    ).toBe(true);
  });
});
