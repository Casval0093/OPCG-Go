import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op01Otsuru036,
  op01Yamato121,
  op02Doberman107,
  op02Kingdew006,
  op02Komille097,
  op02Thatch007,
  op02Yamakaji116,
  op03Namule007,
  op16Mahoroba101,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Opponent bodies, all genuinely vanilla, pinning the cost line from both sides:
//   op02Komille097   cost 1  -- clear of the line, so `lte 2` cannot be read as `gte 2`
//   op02Doberman107  cost 2  -- ON the line
//   op02Yamakaji116  cost 3  -- excluded
//
// This card costs 2 to play, so `activeDon: 2`. `trashCount` is the trash size BEFORE it is
// played; the Event itself lands in the trash before its own [Main] resolves, so the condition
// sees trashCount + 1 (ruling #1010).
function mahorobaWith(trashCount: number, extra: PlayerFixture = {}) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      hand: [op16Mahoroba101],
      trash: trashCount,
      activeDon: 2,
      ...extra,
    },
    {
      leaderCardId: op16PortgasDAce001,
      character: [op02Komille097, op02Doberman107, op02Yamakaji116],
    },
    { firstPlayer: "north", activeSeat: "south" },
  );
  engine.playCard(op16Mahoroba101, "south");
  // The unconditional +3000 comes first and always asks for a recipient.
  engine.resolveDecision(
    "effectTargetSelection",
    { selectedIds: [engine.leader("south")] },
    "south",
  );
  return engine;
}

describe("OP16-101 Mahoroba", () => {
  test("ruling #1010: at 9 cards in trash, the Event itself makes 10 and the K.O. happens", () => {
    // An Event is already in its own trash when its [Main] resolves (engine/commands.ts trashes it
    // before running the queued effect), so this card counts itself: 9 + 1 = 10. Encoding
    // printed-minus-one would be wrong AND would still pass a test written at 10-before.
    const engine = mahorobaWith(9);
    const komilleId = engine.findCardInZone("north", "character", op02Komille097);
    const dobermanId = engine.findCardInZone("north", "character", op02Doberman107);
    const yamakajiId = engine.findCardInZone("north", "character", op02Yamakaji116);

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (ko?.kind !== "selectEntity") throw new Error("Expected the K.O. target choice.");
    expect(ko.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [komilleId, dobermanId].sort(),
    );
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(yamakajiId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [dobermanId] }, "south");

    expect(
      engine
        .getView("north")
        .players.north.characters.some((card) => card?.instanceId === dobermanId),
    ).toBe(false);
  });

  test("at 8 cards in trash (9 after) the K.O. does not happen, but the +3000 still does", () => {
    const engine = mahorobaWith(8);

    // No second prompt: the K.O. carries its own condition, so only that action is gated.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(
      engine.getState().players.north.characterArea.filter((entry) => entry !== null),
    ).toHaveLength(3);
  });

  test("well clear of the threshold the K.O. still happens", () => {
    // 15 cards in trash satisfies `gte 10` and NOT `lte 10`, which is what separates the two
    // comparisons -- at exactly 10 they are indistinguishable.
    const engine = mahorobaWith(15);

    expect(engine.pendingDecision("effectTargetSelection", "south").steps[0]?.kind).toBe(
      "selectEntity",
    );
  });

  test("[Main] +3000 lets a 5000-power body trade up into an 8000-power defender", () => {
    // The magnitude decides a battle rather than being read back off a projection: 5000 + 3000 =
    // 8000 against an 8000-power rested defender is a K.O. (`attackPower >= defensePower`), while
    // the mutation to +2000 leaves the attacker at 7000 and the defender alive.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16Mahoroba101],
        character: [{ card: op03Namule007, playedOnTurn: 0 }],
        activeDon: 2,
      },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Thatch007, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const defenderId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.playCard(op16Mahoroba101, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    engine.declareAttack(namuleId, defenderId, "south");
    expect(
      engine
        .getView("north")
        .players.north.characters.some((card) => card?.instanceId === defenderId),
    ).toBe(false);
  });

  test("[Trigger] adds up to 1 [Yamato] from your trash to your hand", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        life: [op16Mahoroba101, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
        // op01Yamato121 is a Character named Yamato -- inert here, since a card in the trash never
        // resolves anything and adding it to hand does not either. op01Otsuru036 is another Land of
        // Wano body under a different name, and is what makes the name filter observable.
        trash: [op01Yamato121, op01Otsuru036],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const yamatoId = engine.findCardInZone("north", "trash", op01Yamato121);
    const otsuruId = engine.findCardInZone("north", "trash", op01Otsuru036);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const add = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (add?.kind !== "selectEntity") throw new Error("Expected the Yamato retrieval choice.");
    expect(add.candidates.map((candidate) => candidate.ref.id)).toEqual([yamatoId]);
    expect(add.candidates.map((candidate) => candidate.ref.id)).not.toContain(otsuruId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [yamatoId] }, "north");

    expect(engine.getState().players.north.hand).toContain(yamatoId);
  });
});
