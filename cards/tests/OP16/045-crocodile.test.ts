import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op01Bellamy076,
  op01Sai012,
  op02Blugori084,
  op02ImpelDown092,
  op02LittleoarsJr020,
  op02Sphinx088,
  op16Crocodile045,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// There is no vanilla [Impel Down] Character at cost 2 anywhere in OP01-OP14/EB/PRB/ST01 -- the
// trait's cheap bodies are 1 (op02Blugori084) and then 3+. A body exactly ON the "cost of 2 or
// less" line is what proves the threshold rather than merely the filter's existence, so spread
// the cost-1 one and move it up.
const impelDownCostTwo: CharacterCard = {
  ...op02Blugori084,
  id: "TEST-OP16-045-IMPEL-DOWN-2",
  canonicalId: "TEST-OP16-045-IMPEL-DOWN-2",
  cost: 2,
};

registerCards([impelDownCostTwo]);

describe("OP16-045 Crocodile", () => {
  test("ruling #989: Crocodile may pay its own [On Play] cost by returning ITSELF, and still plays the cheap body", () => {
    const engine = OnePieceTestEngine.create(
      {
        // op01Sai012 is cost 2 -- exactly on the "cost of 2 or more" line, so it pins that
        // threshold from below; op02Blugori084 at cost 1 is the body that must be excluded.
        character: [op02Blugori084, op01Sai012],
        hand: [
          op16Crocodile045,
          op02Blugori084, // cost 1, Impel Down  -> playable
          impelDownCostTwo, // cost 2, Impel Down  -> playable, on the boundary
          op02Sphinx088, // cost 4, Impel Down  -> excluded by the cost filter
          op01Bellamy076, // cost 2, Dressrosa   -> excluded by the trait filter
          // A `play` action's candidate pool is pre-filtered to stage-or-character, so only a
          // STAGE can exercise `cardCategory: "character"`; an Event proves nothing
          // (cards/ENCODING.md). OP02-092 Impel Down is cost 1 and carries the trait, so it
          // clears every other filter on the action.
          op02ImpelDown092,
        ],
        activeDon: 4,
      },
      {},
    );
    const blugoriFieldId = engine.findCardInZone("south", "character", op02Blugori084);
    const saiId = engine.findCardInZone("south", "character", op01Sai012);
    const blugoriHandId = engine.findCardInZone("south", "hand", op02Blugori084);
    const costTwoId = engine.findCardInZone("south", "hand", impelDownCostTwo);

    engine.playCard(op16Crocodile045, "south");
    const crocodileId = engine.findCardInZone("south", "character", op16Crocodile045);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // No `excludeSelf`: Crocodile (cost 4) is in its own cost's candidate pool. That is what
    // ruling #989 turns on, and it is the one thing that would break if this were modelled on
    // OP08-047 Jozu, whose printed text DOES say "other than this Character".
    const cost = engine.pendingDecision("effectCostReturnCharacter", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Crocodile's return-a-Character cost.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [saiId, crocodileId].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(blugoriFieldId);
    engine.resolveDecision("effectCostReturnCharacter", { selectedIds: [crocodileId] }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Crocodile's play selection.");
    expect(play.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [blugoriHandId, costTwoId].sort(),
    );
    engine.resolveDecision("effectPlaySelection", { selectedIds: [costTwoId] }, "south");

    const view = engine.getView("south");
    // Crocodile went back to hand and the effect still resolved -- 可以, per the ruling.
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(crocodileId);
    expect(view.players.south.characters.some((card) => card?.instanceId === crocodileId)).toBe(
      false,
    );
    expect(view.players.south.characters.some((card) => card?.instanceId === costTwoId)).toBe(true);
    expect(view.prompts).toHaveLength(0);
  });

  test("[On Play] is optional: declining leaves the board and hand untouched", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [op01Sai012],
        hand: [op16Crocodile045, op02Blugori084],
        activeDon: 4,
      },
      {},
    );
    const saiId = engine.findCardInZone("south", "character", op01Sai012);
    const blugoriHandId = engine.findCardInZone("south", "hand", op02Blugori084);

    engine.playCard(op16Crocodile045, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === saiId)).toBe(true);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(blugoriHandId);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Blocker] redirects an attack away from the Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { character: [op16Crocodile045] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const crocodileId = engine.findCardInZone("north", "character", op16Crocodile045);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Crocodile's Blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(crocodileId);
    engine.resolveDecision("battleBlocker", { selectedIds: [crocodileId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(crocodileId);
    expect(view.players.north.lifeCount).toBe(lifeBefore);
  });
});
