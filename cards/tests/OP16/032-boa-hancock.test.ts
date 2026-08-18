import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Atmos003,
  op02Kingdew006,
  op02LittleoarsJr020,
  op03Pearl031,
  op16BoaHancock032,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// There is no vanilla Character named Monkey.D.Luffy anywhere in OP01-OP14/EB/PRB/ST01, so the
// exclusion needs a synthetic body. The `name` family of filters resolves through cardName()
// (shared.ts), which reads `i18n.en.name` -- overriding only the top-level `name` leaves the
// filter matching the spread-from card's name and the test silently proves nothing.
const namedLuffy: CharacterCard = {
  ...op02Atmos003,
  id: "TEST-OP16-032-LUFFY",
  canonicalId: "TEST-OP16-032-LUFFY",
  name: "Monkey.D.Luffy",
  i18n: { en: { ...op02Atmos003.i18n.en, name: "Monkey.D.Luffy" } },
};

registerCards([namedLuffy]);

describe("OP16-032 Boa Hancock", () => {
  test("[On Play] targets any opponent Character except one named [Monkey.D.Luffy]", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16BoaHancock032], activeDon: op16BoaHancock032.cost },
      { character: [op02Kingdew006, namedLuffy] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const eligibleId = engine.findCardInZone("north", "character", op02Kingdew006);
    const luffyId = engine.findCardInZone("north", "character", namedLuffy);

    engine.playCard(op16BoaHancock032, "south");

    const target = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(target).toMatchObject({ kind: "selectEntity", min: 0, max: 1 });
    if (target?.kind !== "selectEntity") throw new Error("Expected Hancock's target choice.");
    expect(target.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(target.candidates.map((candidate) => candidate.ref.id)).not.toContain(luffyId);
  });

  test("the chosen Character cannot attack on the opponent's next turn; an untouched one can", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16BoaHancock032], activeDon: op16BoaHancock032.cost },
      {
        character: [
          { card: op02Kingdew006, playedOnTurn: 0 },
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const lockedId = engine.findCardInZone("north", "character", op02Kingdew006);
    const freeId = engine.findCardInZone("north", "character", op02LittleoarsJr020);

    engine.playCard(op16BoaHancock032, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [lockedId] }, "south");
    engine.endTurn("south");

    // Attacking rests the attacker, so canAttackWith (battle.ts) refuses outright for a body
    // that cannot be rested. The paired control on the same fixture is what makes this a test
    // of the restriction rather than of the fixture.
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "north",
        attackerId: lockedId,
        targetId: engine.leader("south"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
    engine.declareAttack(freeId, engine.leader("south"), "north");
    expect(engine.getState().cards[freeId]?.rested).toBe(true);
  });

  test("[Unblockable] is real: an active [Blocker] is never offered against Hancock", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: op16BoaHancock032, playedOnTurn: 0 },
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
        ],
      },
      { character: [op03Pearl031] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const hancockId = engine.findCardInZone("south", "character", op16BoaHancock032);
    const plainAttackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const blockerId = engine.findCardInZone("north", "character", op03Pearl031);

    // Control first, on the same fixture: a 9000 attacker WITHOUT the keyword does open the
    // blocker step, so "no prompt" below cannot be explained by a broken blocker fixture.
    engine.declareAttack(plainAttackerId, engine.leader("north"), "south");
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the blocker step.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(blockerId);
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "north");

    engine.declareAttack(hancockId, engine.leader("north"), "south");
    // Naming the intent rather than asserting "no prompts at all": the Leader taking damage
    // can legitimately publish a lifeTrigger prompt here, which says nothing about blocking.
    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
        ),
    ).toBe(false);
  });
});
