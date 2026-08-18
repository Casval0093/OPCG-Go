import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Doberman107,
  op02Kingdew006,
  op02Komille097,
  op02Sphinx088,
  op02Yamakaji116,
  op03Namule007,
  op13MonkeyDLuffy001,
  op16GumGumTwinJetPistol039,
  op16MonkeyDLuffy022,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Opponent bodies, all genuinely vanilla, chosen so the cost line is pinned from both sides:
//   op02Komille097   cost 1   -- clear of the boundary, so `lte 3` cannot be confused for `gte 3`
//   op02Doberman107  cost 2
//   op02Yamakaji116  cost 3   -- ON the boundary, the only thing that pins the number itself
//   op02Sphinx088    cost 4   -- excluded
//
// Leaders: op16MonkeyDLuffy022 is named Monkey.D.Luffy AND has the [Impel Down] type (its own
// ability is an [Activate: Main], never triggered here); op13MonkeyDLuffy001 is also named
// Monkey.D.Luffy but is "Straw Hat Crew Supernovas", so it separates the name filter on the grant
// from the Leader-type condition on the rest.

const opponentBoard = [op02Komille097, op02Doberman107, op02Yamakaji116, op02Sphinx088];

describe("OP16-039 Gum-Gum Twin Jet Pistol", () => {
  test("grants [Double Attack] to a [Monkey.D.Luffy] card, then rests cost-3-or-less opponents", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16MonkeyDLuffy022,
        hand: [op16GumGumTwinJetPistol039],
        // A Character of your own that is NOT named Monkey.D.Luffy: without it, deleting the name
        // filter would change nothing this test can see.
        character: [op03Namule007],
        activeDon: 1,
      },
      { leaderCardId: op16PortgasDAce001, character: opponentBoard },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const komilleId = engine.findCardInZone("north", "character", op02Komille097);
    const dobermanId = engine.findCardInZone("north", "character", op02Doberman107);
    const yamakajiId = engine.findCardInZone("north", "character", op02Yamakaji116);
    const sphinxId = engine.findCardInZone("north", "character", op02Sphinx088);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.playCard(op16GumGumTwinJetPistol039, "south");

    const grant = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (grant?.kind !== "selectEntity") throw new Error("Expected the Double Attack grant.");
    // "your [Monkey.D.Luffy] CARDS" reaches the Leader, and reaches nothing else here.
    expect(grant.candidates.map((candidate) => candidate.ref.id)).toEqual([engine.leader("south")]);
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    const rest = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (rest?.kind !== "selectEntity") throw new Error("Expected the rest-up-to-2 choice.");
    expect(rest.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [komilleId, dobermanId, yamakajiId].sort(),
    );
    expect(rest.candidates.map((candidate) => candidate.ref.id)).not.toContain(sphinxId);
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [yamakajiId, komilleId] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[yamakajiId]?.rested).toBe(true);
    expect(state.cards[komilleId]?.rested).toBe(true);
    expect(state.cards[dobermanId]?.rested).toBe(false);

    // Granted keywords have no projected field to read, so prove [Double Attack] functionally: a
    // connecting Leader attack takes TWO Life cards instead of one. 5000 vs 5000 connects, since
    // `attackPower >= defensePower` is a hit.
    engine.declareAttack(engine.leader("south"), engine.leader("north"), "south");
    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore - 2);
  });

  test("without an [Impel Down] Leader the grant still happens but nothing is rested", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op13MonkeyDLuffy001,
        hand: [op16GumGumTwinJetPistol039],
        activeDon: 1,
      },
      { leaderCardId: op16PortgasDAce001, character: opponentBoard },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op16GumGumTwinJetPistol039, "south");
    // The Leader check sits in the LATER sentence, so it gates only the rest -- the grant is
    // offered regardless, which is the OP15-056/#899 half of the per-card split.
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    const state = engine.getState();
    expect(engine.getView("south").prompts).toHaveLength(0);
    // characterArea carries nulls for empty slots, so filter before indexing `state.cards`.
    const opponentIds = state.players.north.characterArea.filter(
      (entry): entry is string => entry !== null,
    );
    expect(opponentIds).toHaveLength(4);
    for (const instanceId of opponentIds) {
      expect(state.cards[instanceId]?.rested).toBe(false);
    }
  });

  test("[Trigger] rests your opponent's Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16MonkeyDLuffy022,
        life: [op16GumGumTwinJetPistol039, eb01Doma005, eb01Doma005, eb01Doma005],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );

    // 7000 beats the 5000-power Leader, so life[0] -- the event -- is removed and its [Trigger]
    // may be activated.
    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // "your opponent's Leader" is relative to the [Trigger]'s controller (north), so it is south's
    // Leader that ends up rested -- not the Leader that just took the damage.
    expect(engine.getState().cards[engine.leader("south")]?.rested).toBe(true);
    expect(engine.getState().cards[engine.leader("north")]?.rested).toBe(false);
  });
});
