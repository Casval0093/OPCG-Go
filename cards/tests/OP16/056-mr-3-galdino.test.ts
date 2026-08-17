import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import { eb02DonAccino004, op01Sai012, op02Atmos003, op16Mr3Galdino056 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The vanilla pool tops out at cost 8 (cards/ENCODING.md), so "a cost of 9 or less" has no
// on-the-line body and no just-over-the-line body to exclude. Spread the cost-8 vanilla twice.
const costNine: CharacterCard = {
  ...eb02DonAccino004,
  id: "TEST-OP16-056-COST-9",
  canonicalId: "TEST-OP16-056-COST-9",
  cost: 9,
};

const costTen: CharacterCard = {
  ...eb02DonAccino004,
  id: "TEST-OP16-056-COST-10",
  canonicalId: "TEST-OP16-056-COST-10",
  cost: 10,
};

registerCards([costNine, costTen]);

describe("OP16-056 Mr.3(Galdino)", () => {
  test("trashing itself draws 2 and locks down a cost-9 Character until the end of the opponent's next End Phase", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr3Galdino056, playedOnTurn: 0 }],
        deck: [op02Atmos003, op01Sai012, op02Atmos003, op01Sai012, op02Atmos003],
        hand: [],
      },
      {
        // cost 2 and cost 9 are inside "9 or less", cost 10 is outside. The cost-9 body is what
        // pins the threshold; the cost-2 one is what stops lte from being indistinguishable
        // from gte at the boundary.
        character: [
          { card: op01Sai012, playedOnTurn: 0 },
          { card: costNine, playedOnTurn: 0 },
          { card: costTen, playedOnTurn: 0 },
        ],
        hand: [],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const galdinoId = engine.findCardInZone("south", "character", op16Mr3Galdino056);
    const saiId = engine.findCardInZone("north", "character", op01Sai012);
    const nineId = engine.findCardInZone("north", "character", costNine);
    const tenId = engine.findCardInZone("north", "character", costTen);
    const firstDrawId = engine.findCardInZone("south", "deck", op02Atmos003);

    engine.activateEffect(galdinoId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Galdino's lockdown target.");
    expect(selection.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [saiId, nineId].sort(),
    );
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(tenId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [nineId] }, "south");

    let view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(galdinoId);
    expect(view.players.south.characters.some((card) => card?.instanceId === galdinoId)).toBe(
      false,
    );
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(firstDrawId);
    expect(view.prompts).toHaveLength(0);

    engine.endTurn("south");

    // Functional proof of the restriction and its duration: on the opponent's very next turn
    // the chosen body cannot attack, while the untouched one can.
    const blocked = engine.expectFailure({
      type: "declareAttack",
      seat: "north",
      attackerId: nineId,
      targetId: engine.leader("south"),
    });
    expect(blocked.accepted).toBe(false);
    engine.declareAttack(tenId, engine.leader("south"), "north");
    view = engine.getView("north");
    expect(view.players.north.characters.find((card) => card?.instanceId === tenId)?.rested).toBe(
      true,
    );
  });

  test("declining leaves Mr.3 on the field and draws nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Mr3Galdino056, playedOnTurn: 0 }],
        deck: [op02Atmos003, op01Sai012, op02Atmos003, op01Sai012, op02Atmos003],
        hand: [],
      },
      { character: [{ card: op01Sai012, playedOnTurn: 0 }] },
    );
    const galdinoId = engine.findCardInZone("south", "character", op16Mr3Galdino056);

    engine.activateEffect(galdinoId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === galdinoId)).toBe(true);
    expect(view.players.south.hand).toHaveLength(0);
    expect(view.prompts).toHaveLength(0);
  });
});
