import { describe, expect, test } from "vite-plus/test";
import { op02Kingdew006, op03Namule007, op16RoronoaZoro035 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// A `rest` target spanning field zones AND costArea publishes intent `effectMixedRestSelection`
// with step kind `payCost`, not the usual `effectTargetSelection`/`selectEntity`.

describe("OP16-035 Roronoa Zoro", () => {
  test("rests one of the opponent's cards -- Leader, Stage and DON!! all count -- then trades a hand card for 3 rested DON!! on your Leader", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16RoronoaZoro035, op03Namule007], activeDon: op16RoronoaZoro035.cost },
      { character: [op02Kingdew006], activeDon: 1 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const opponentBodyId = engine.findCardInZone("north", "character", op02Kingdew006);
    const discardId = engine.findCardInZone("south", "hand", op03Namule007);
    const southLeaderId = engine.leader("south");
    const northLeaderId = engine.leader("north");

    engine.playCard(op16RoronoaZoro035, "south");

    const rest = engine.pendingDecision("effectMixedRestSelection", "south").steps[0];
    expect(rest).toMatchObject({ kind: "payCost", min: 0, max: 1 });
    if (rest?.kind !== "payCost") throw new Error("Expected Zoro's rest choice.");
    const restCandidates = rest.candidates.map((candidate) => candidate.ref.id);
    // "cards", not "Characters": the opponent's Leader and their active DON!! are legal
    // choices too. Nothing of yours ever is.
    expect(restCandidates).toContain(northLeaderId);
    expect(restCandidates).toContain(opponentBodyId);
    expect(restCandidates.some((id) => id.startsWith("active-don:north:"))).toBe(true);
    expect(restCandidates).not.toContain(southLeaderId);
    engine.resolveDecision("effectMixedRestSelection", { selectedIds: [opponentBodyId] }, "south");

    // Paying Zoro's own cost rested all 7 DON!!, which is what the giveDon draws from.
    expect(engine.getView("south").players.south.restedDon).toBe(7);

    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const count = engine.pendingDecision("effectGiveDonCount", "south").steps[0];
    expect(count?.kind).toBe("chooseOption");
    if (count?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // The printed cap is 3, not "as many as are rested" -- 7 are rested and available here, so
    // this option list is the only thing pinning the number (the mutation checker never
    // perturbs a single-digit count).
    expect(count.options.map((option) => option.id)).toEqual(["0", "1", "2", "3"]);
    engine.resolveDecision("effectGiveDonCount", { optionId: "3" }, "south");

    const view = engine.getView("south");
    expect(engine.getState().cards[opponentBodyId]?.rested).toBe(true);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(discardId);
    expect(engine.getState().cards[southLeaderId]?.attachedDon).toBe(3);
    expect(view.players.south.restedDon).toBe(4);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #985: resting nothing does not stop the trash-for-DON!! half", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16RoronoaZoro035, op03Namule007], activeDon: op16RoronoaZoro035.cost },
      { character: [op02Kingdew006] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const discardId = engine.findCardInZone("south", "hand", op03Namule007);
    const opponentBodyId = engine.findCardInZone("north", "character", op02Kingdew006);
    const southLeaderId = engine.leader("south");

    engine.playCard(op16RoronoaZoro035, "south");
    // Decline the "up to 1" entirely -- nothing of the opponent's is rested.
    engine.resolveDecision("effectMixedRestSelection", { selectedIds: [] }, "south");
    expect(engine.getState().cards[opponentBodyId]?.rested).toBe(false);

    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "2" }, "south");

    expect(engine.getView("south").players.south.trash.map((card) => card.instanceId)).toContain(
      discardId,
    );
    expect(engine.getState().cards[southLeaderId]?.attachedDon).toBe(2);
  });

  test("declining the trash gives no DON!! -- 'if you do' is a real cost", () => {
    const engine = OnePieceTestEngine.create(
      { hand: [op16RoronoaZoro035, op03Namule007], activeDon: op16RoronoaZoro035.cost },
      { character: [op02Kingdew006] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const keptId = engine.findCardInZone("south", "hand", op03Namule007);
    const opponentBodyId = engine.findCardInZone("north", "character", op02Kingdew006);
    const southLeaderId = engine.leader("south");

    engine.playCard(op16RoronoaZoro035, "south");
    engine.resolveDecision("effectMixedRestSelection", { selectedIds: [opponentBodyId] }, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    // The first half still happened; only the optional second half was declined.
    expect(engine.getState().cards[opponentBodyId]?.rested).toBe(true);
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([keptId]);
    expect(engine.getState().cards[southLeaderId]?.attachedDon).toBe(0);
    expect(view.prompts).toHaveLength(0);
  });
});
