import { describe, expect, test } from "vite-plus/test";
import {
  eb01MountainGod018,
  op01Carrot009,
  op01Speed104,
  op03Namule007,
  op09BlackVortex097,
  op09DocQ090,
  op16BlackVortex115,
  op16MarshallDTeach080,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Trash fixtures:
//   op01Carrot009      its only effect block is a `trigger:` one -- eligible
//   op01Speed104       likewise eligible, so the "exact candidate set" assertion has two members
//                      and cannot pass by accident on a single-candidate list
//   op09BlackVortex097 ALSO has a [Trigger] block, and is named "Black Vortex" -- ruling #1014's
//                      card, excluded by name rather than by id
//   op03Namule007      no [Trigger] at all -- excluded by `hasTrigger`
//
// Leaders: op16MarshallDTeach080 has the [Blackbeard Pirates] type (its own abilities are an
// [Opponent's Turn] cost bump and an [On Your Opponent's Attack] redirect, both silent on your own
// turn); op16PortgasDAce001 is Whitebeard Pirates and stands in for "a Leader without the type".

describe("OP16-115 Black Vortex", () => {
  test("ruling #1014: the other [Black Vortex] printing is excluded by NAME", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16MarshallDTeach080,
        hand: [op16BlackVortex115],
        trash: [op01Carrot009, op01Speed104, op09BlackVortex097, op03Namule007],
        activeDon: 1,
      },
      {},
    );
    const carrotId = engine.findCardInZone("south", "trash", op01Carrot009);
    const speedId = engine.findCardInZone("south", "trash", op01Speed104);
    const otherVortexId = engine.findCardInZone("south", "trash", op09BlackVortex097);
    const namuleId = engine.findCardInZone("south", "trash", op03Namule007);

    engine.playCard(op16BlackVortex115, "south");

    const retrieve = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (retrieve?.kind !== "selectEntity") throw new Error("Expected the trash retrieval choice.");
    expect(retrieve.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [carrotId, speedId].sort(),
    );
    // OP09-097 has a [Trigger] of its own, so `hasTrigger` alone would admit it; only the name
    // exclusion keeps it out. And Namule, with no [Trigger], is what makes `hasTrigger` itself
    // load-bearing.
    expect(retrieve.candidates.map((candidate) => candidate.ref.id)).not.toContain(otherVortexId);
    expect(retrieve.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [carrotId] }, "south");

    expect(engine.getState().players.south.hand).toContain(carrotId);
  });

  test("[Main] does nothing without a [Blackbeard Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16BlackVortex115],
        trash: [op01Carrot009, op01Speed104],
        activeDon: 1,
      },
      {},
    );

    engine.playCard(op16BlackVortex115, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toHaveLength(0);
  });

  test("[Trigger] negates an opposing Leader or Character for the turn", () => {
    // Proven functionally, the way packages/engine/tests/cards/events/op10-098-liberation.test.ts
    // does it: op09DocQ090 has an [Activate: Main], and once negated the engine no longer offers
    // that activation timing at all.
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: eb01MountainGod018, playedOnTurn: 0 },
          { card: op09DocQ090, playedOnTurn: 0 },
        ],
      },
      { leaderCardId: op16MarshallDTeach080, life: [op16BlackVortex115] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const docQId = engine.findCardInZone("south", "character", op09DocQ090);

    // 7000 beats the 5000-power Leader, so the Life card is removed and its [Trigger] may fire.
    engine.declareAttack(
      engine.findCardInZone("south", "character", eb01MountainGod018),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const negate = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (negate?.kind !== "selectEntity") throw new Error("Expected the negation target choice.");
    // "your opponent's Leader or Character cards" -- both zones are reachable.
    expect(negate.candidates.map((candidate) => candidate.ref.id)).toContain(
      engine.leader("south"),
    );
    expect(negate.candidates.map((candidate) => candidate.ref.id)).toContain(docQId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [docQId] }, "north");

    const failure = engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: docQId,
      trigger: "activateMain",
    });
    expect(failure.reason).toBe("This card does not have that activation timing.");
  });
});
