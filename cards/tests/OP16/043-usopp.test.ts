import { describe, expect, test } from "vite-plus/test";
import {
  eb01Kyros040,
  op01Bellamy076,
  op02Atmos003,
  op02Kingdew006,
  op02LittleoarsJr020,
  op11XDrake017,
  op16Usopp043,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-043 Usopp", () => {
  test("[Blocker] then [On K.O.]: resting the Dressrosa Leader bounces a cost-5-or-less attacker's ally", () => {
    const engine = OnePieceTestEngine.create(
      {
        // The opponent-side pool that the returnToHand target has to discriminate between:
        // 4 and 5 are inside "cost of 5 or less", 6 and 7 are outside. The cost-5 body is the
        // one that matters -- a below-the-line fixture proves a filter exists but not its
        // number, and `value: 5` is a single digit so mutation_check.py never perturbs it.
        character: [
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
          op02Atmos003,
          op02Kingdew006,
          op11XDrake017,
        ],
      },
      {
        // eb01Kyros040 is the [Dressrosa] Leader that pays the cost. Its own ability is an
        // [Activate: Main], so it cannot fire on its own during this sequence.
        leaderCardId: eb01Kyros040,
        character: [op16Usopp043],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const usoppId = engine.findCardInZone("north", "character", op16Usopp043);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    // [Blocker] has no projected field; this is the functional proof of the keyword.
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Usopp's Blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(usoppId);
    engine.resolveDecision("battleBlocker", { selectedIds: [usoppId] }, "north");

    // 9000 into a 1000-power blocker: Usopp dies and his [On K.O.] goes on the queue.
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");

    // Kyros is the only Dressrosa Leader-or-Stage on the field, and a cost with exactly one
    // eligible candidate auto-pays without publishing a prompt (cards/ENCODING.md), so the
    // rest is observed on the Leader afterwards rather than through an effectCostRestCards step.
    const selection = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Usopp's bounce target.");
    expect(selection.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [atmosId, kingdewId].sort(),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.leader.rested).toBe(true);
    // Read the opponent's hand off raw state: projected to north, south's hand is hidden and
    // every instanceId comes back null.
    expect(engine.getState().players.south.hand).toContain(kingdewId);
    expect(view.players.south.characters.some((card) => card?.instanceId === kingdewId)).toBe(
      false,
    );
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(usoppId);
    expect(view.prompts).toHaveLength(0);
  });

  test('the cost really is "[Dressrosa] Leader or Stage": a Dressrosa Character and a non-Dressrosa Leader cannot pay it', () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }, op02Atmos003],
      },
      {
        // Default Leader (OP13-001 Monkey.D.Luffy, "Straw Hat Crew Supernovas") -- a Leader,
        // but not Dressrosa. op01Bellamy076 is Dressrosa, but a Character. No Stage at all.
        // So under the real encoding NOTHING can pay the cost, and an optional block whose
        // costs are unpayable is skipped without even publishing its effectOptional confirm
        // (effects/resolution.ts). Each of the four ways to break the cost filter makes one
        // of these two bodies payable and turns this test red:
        //   delete filter:trait      -> the non-Dressrosa Leader qualifies
        //   delete filter:anyOf      -> the Dressrosa Character qualifies
        //   delete either nested cardCategory -> the surviving group is empty, and an empty
        //     group ANDs to true (matchesTargetFilter), so the anyOf matches everything
        character: [{ card: op16Usopp043, rested: true }, op01Bellamy076],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);
    const usoppId = engine.findCardInZone("north", "character", op16Usopp043);

    engine.declareAttack(attackerId, usoppId, "south");

    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(engine.getView("south").prompts).toHaveLength(0);
    // The K.O. itself happened -- it is only the [On K.O.] payload that never ran.
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(usoppId);
    expect(view.players.south.characters.some((card) => card?.instanceId === atmosId)).toBe(true);
    expect(view.players.north.leader.rested).toBe(false);
  });

  test("[On K.O.] is optional: declining leaves the Leader active and the opponent's board intact", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }, op02Atmos003],
      },
      {
        leaderCardId: eb01Kyros040,
        character: [{ card: op16Usopp043, rested: true }],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);
    const usoppId = engine.findCardInZone("north", "character", op16Usopp043);

    engine.declareAttack(attackerId, usoppId, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "north");

    const view = engine.getView("north");
    expect(view.players.north.leader.rested).toBe(false);
    expect(view.players.south.characters.some((card) => card?.instanceId === atmosId)).toBe(true);
    expect(view.prompts).toHaveLength(0);
  });
});
