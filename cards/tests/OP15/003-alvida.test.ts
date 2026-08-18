import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02Atmos003,
  op02Seaquake021,
  op02Thatch007,
  op03Namule007,
  op15Alvida003,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Fixtures, all vanilla pre-OP15 engine cards. Each hand card isolates one half of the filter pair
// on the replacement's `trashFromHand`:
//   op02Atmos003     Character, 6000 -- EXACTLY on the "6000 or less" line
//   op03Namule007    Character, 5000 -- clear of the line on the legal side
//   op02Kingdew006   Character, 7000 -- clear of the line on the illegal side
//   op02Seaquake021  EVENT           -- basePower() hard-zeroes Events, so 0 <= 6000 and it is a
//                                       genuine false positive for `power lte 6000`. This is the
//                                       opposite of the OP16 "power eq 8000" case, where Events
//                                       were already excluded by the power filter itself.
//   op02Thatch007    Character, 8000 -- north's attacker, big enough to K.O. Alvida (6000)

function alvidaAttacked(hand: PlayerFixture["hand"]) {
  return OnePieceTestEngine.create(
    { character: [{ card: op15Alvida003, rested: true }], hand },
    { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

describe("OP15-003 Alvida", () => {
  test("a battle K.O. offers only 6000-or-less Character cards from hand as the replacement cost", () => {
    const engine = alvidaAttacked([op02Atmos003, op03Namule007, op02Kingdew006, op02Seaquake021]);
    const alvidaId = engine.findCardInZone("south", "character", op15Alvida003);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const atmosId = engine.findCardInZone("south", "hand", op02Atmos003);
    const namuleId = engine.findCardInZone("south", "hand", op03Namule007);
    const lifeBefore = engine.getView("south").players.south.lifeCount;

    engine.declareAttack(thatchId, alvidaId, "north");
    // South's hand is non-empty, so a [Counter] step opens before damage resolves.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    // A `trashFromHand` battle-K.O. replacement is ONE `selectCards` prompt whose options are
    // already the filter-matched hand, not a confirm followed by a payment -- so this candidate
    // list is the only place the replacement's filters are observable.
    const replacement = engine.pendingDecision("battleKoReplacement", "south").steps[0];
    if (replacement?.kind !== "selectEntity")
      throw new Error("Expected Alvida's hand-trash choice.");
    expect(replacement.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [atmosId, namuleId].sort(),
    );

    engine.resolveDecision("battleKoReplacement", { selectedIds: [atmosId] }, "south");

    const view = engine.getView("south");
    expect(engine.findCardInZone("south", "character", op15Alvida003)).toBe(alvidaId);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(atmosId);
    expect(view.players.south.lifeCount).toBe(lifeBefore);
  });

  test('declining the replacement lets Alvida die -- it is a "may"', () => {
    const engine = alvidaAttacked([op02Atmos003, op03Namule007]);
    const alvidaId = engine.findCardInZone("south", "character", op15Alvida003);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);
    const atmosId = engine.findCardInZone("south", "hand", op02Atmos003);

    engine.declareAttack(thatchId, alvidaId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
    // Declining a `trashFromHand` replacement is an empty selection, not `{ optionId: "no" }`.
    engine.resolveDecision("battleKoReplacement", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(alvidaId);
    expect(view.players.south.trash.map((card) => card.instanceId)).not.toContain(atmosId);
  });

  test("with nothing eligible in hand the replacement is never offered at all", () => {
    // Kingdew is over the power line and Seaquake is the wrong card category, so
    // `replacementActionIsAvailable` filters both out and no prompt is built. Drop EITHER filter
    // from the encoding and one of them becomes payable, which turns this red -- so this case
    // covers both filters a second time, by absence rather than by candidate list.
    const engine = alvidaAttacked([op02Kingdew006, op02Seaquake021]);
    const alvidaId = engine.findCardInZone("south", "character", op15Alvida003);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, alvidaId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(
      engine
        .getState()
        .promptQueue.filter((prompt) => prompt.status === "pending")
        .map((prompt) => prompt.resolutionContext?.intent),
    ).not.toContain("battleKoReplacement");
    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      alvidaId,
    );
  });

  test("the replacement protects only Alvida itself, not another Character", () => {
    // `eventFilter: { targetSelf: true }` -- "If THIS Character would be K.O.'d". Namule is the one
    // under attack here and Alvida is a bystander; drop the targetSelf and the prompt appears.
    const engine = OnePieceTestEngine.create(
      {
        character: [op15Alvida003, { card: op03Namule007, rested: true }],
        hand: [op02Atmos003],
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, namuleId, "north");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");

    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      namuleId,
    );
    expect(engine.findCardInZone("south", "character", op15Alvida003)).toBeTruthy();
  });
});
