import { describe, expect, test } from "vite-plus/test";
import { eb01MountainGod018, op16ShimotsukiUshimaru088 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-088 Shimotsuki Ushimaru", () => {
  test("[Blocker] becomes the new target of the attack, sparing the Leader's Life", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: eb01MountainGod018, playedOnTurn: 0 }] },
      { character: [op16ShimotsukiUshimaru088] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", eb01MountainGod018);
    const ushimaruId = engine.findCardInZone("north", "character", op16ShimotsukiUshimaru088);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    // The keyword is this card's entire printed ability: with `keywords: ["blocker"]` removed
    // there is no blocker step at all and pendingDecision throws here.
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Ushimaru's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(ushimaruId);
    engine.resolveDecision("battleBlocker", { selectedIds: [ushimaruId] }, "north");

    const view = engine.getView("north");
    // 7000 attacker against Ushimaru's 2000: it took the hit instead of the Leader and died.
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(ushimaruId);
    expect(view.prompts).toHaveLength(0);
  });

  test("blocking is optional -- declining leaves the Leader to take the damage", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: eb01MountainGod018, playedOnTurn: 0 }] },
      { character: [op16ShimotsukiUshimaru088] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", eb01MountainGod018);
    const ushimaruId = engine.findCardInZone("north", "character", op16ShimotsukiUshimaru088);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    // GENERAL ruling #16: a [Blocker] on the field never has to be activated.
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.lifeCount).toBe(lifeBefore - 1);
    expect(view.players.north.characters.map((card) => card?.instanceId)).toContain(ushimaruId);
  });
});
