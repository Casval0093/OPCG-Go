import { describe, expect, test } from "vite-plus/test";
import { op01Sai012, op02Kingdew006, op16BoaSandersonia111 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

describe("OP16-111 Boa Sandersonia", () => {
  test("ruling #1013: the [Trigger] plays it when Life is 3 INCLUDING this card", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { life: [op16BoaSandersonia111, op01Sai012, op01Sai012] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const sandersoniaId = engine.findCardInZone("north", "life", op16BoaSandersonia111);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // The card is already out of the Life area when its own [Trigger] resolves, so the count it
    // sees is 2, not 3. That is why the encoding carries the printed number rather than 3.
    expect(engine.getState().players.north.life).toHaveLength(2);
    expect(engine.getState().cards[sandersoniaId]?.zone).toBe("character");
  });

  test("the [Trigger] does nothing with Life well above the threshold", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        // 5 Life -> 4 once this card leaves. 4 is clear of the line in a way 3 is not: at exactly
        // 2 remaining, `lte 2` and `gte 2` both hold, so only a case like this one separates them.
        life: [op16BoaSandersonia111, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const sandersoniaId = engine.findCardInZone("north", "life", op16BoaSandersonia111);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getState().players.north.life).toHaveLength(4);
    expect(engine.getState().cards[sandersoniaId]?.zone).toBe("trash");
    expect(engine.getState().players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });

  test("[Blocker] is unconditional -- it is offered at full Life", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { character: [op16BoaSandersonia111] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const sandersoniaId = engine.findCardInZone("north", "character", op16BoaSandersonia111);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a Blocker decision.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(sandersoniaId);

    engine.resolveDecision("battleBlocker", { selectedIds: [sandersoniaId] }, "north");

    // Activating [Blocker] rests the blocker and redirects the attack onto it.
    expect(engine.getState().cards[sandersoniaId]?.rested).toBe(true);
  });
});
