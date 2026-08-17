import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import { op01Sai012, op02Kingdew006, op03Namule007, op16GeckoMoria105 } from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Each of the three named plays needs TWO fixtures of that name to be provable: one at or under
// cost 4 (eligible) and one above it (excluded). No printed Absalom or Dr. Hogback costs more than
// 4, so the excluded copies are synthetic -- and without them a deleted cost filter would leave the
// candidate lists identical and the test would pass on a broken encoding.
//
// They are spread from a genuinely vanilla Character (op03Namule007) rather than from a real
// Absalom/Hogback/Perona printing, all of which carry [On Play] effects that would open extra
// prompts the moment one is played. `cardNames()` (shared.ts) resolves from `i18n.en.name`, not the
// top-level `name`, so both are overridden.
function named(name: string, cost: number, suffix: string): CharacterCard {
  return {
    ...op03Namule007,
    id: `TEST-OP16-105-${suffix}`,
    canonicalId: `TEST-OP16-105-${suffix}`,
    name,
    cost,
    i18n: { en: { ...op03Namule007.i18n.en, name } },
  };
}

const absalomEligible = named("Absalom", 4, "ABSALOM-4");
const absalomTooExpensive = named("Absalom", 6, "ABSALOM-6");
const hogbackEligible = named("Dr. Hogback", 4, "HOGBACK-4");
const hogbackTooExpensive = named("Dr. Hogback", 6, "HOGBACK-6");
const peronaEligible = named("Perona", 4, "PERONA-4");
const peronaTooExpensive = named("Perona", 6, "PERONA-6");

registerCards([
  absalomEligible,
  absalomTooExpensive,
  hogbackEligible,
  hogbackTooExpensive,
  peronaEligible,
  peronaTooExpensive,
]);

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

const TRASH = [
  absalomEligible,
  absalomTooExpensive,
  hogbackEligible,
  hogbackTooExpensive,
  peronaEligible,
  peronaTooExpensive,
];

// `getView(seat).decisions` always carries an `actions:<seat>` entry for the active seat, so it can
// never be empty for that seat. Assert absence against the real prompt queue instead.
function pendingIntents(engine: OnePieceTestEngine): string[] {
  return engine
    .getState()
    .promptQueue.filter((prompt) => prompt.status === "pending")
    .map((prompt) => prompt.resolutionContext?.intent ?? "unknown");
}

describe("OP16-105 Gecko Moria", () => {
  test("[Trigger] at 1 or less Life offers each named cost-4-or-less body separately", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      // 2 Life -> 1 once this card leaves the Life area, which satisfies "1 or less Life cards".
      { life: [op16GeckoMoria105, op01Sai012], trash: TRASH },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const eligible = {
      absalom: engine.findCardInZone("north", "trash", absalomEligible),
      hogback: engine.findCardInZone("north", "trash", hogbackEligible),
      perona: engine.findCardInZone("north", "trash", peronaEligible),
    };
    const excluded = {
      absalom: engine.findCardInZone("north", "trash", absalomTooExpensive),
      hogback: engine.findCardInZone("north", "trash", hogbackTooExpensive),
      perona: engine.findCardInZone("north", "trash", peronaTooExpensive),
    };

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    // Three independent "up to 1" selections, resolved in printed order. Each list is exactly one
    // card: the name filter keeps the other two names out, the cost filter keeps the cost-6 copy
    // of its own name out.
    for (const [name, eligibleId] of [
      ["Absalom", eligible.absalom],
      ["Dr. Hogback", eligible.hogback],
      ["Perona", eligible.perona],
    ] as const) {
      const play = engine.pendingDecision("effectPlaySelection", "north").steps[0];
      expect(play?.kind).toBe("selectEntity");
      if (play?.kind !== "selectEntity") throw new Error(`Expected the ${name} play choice.`);
      expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
      // Only the last of the three actually plays a card; the first two decline, which "up to 1"
      // permits (GENERAL ruling #5).
      engine.resolveDecision(
        "effectPlaySelection",
        { selectedIds: name === "Perona" ? [eligibleId] : [] },
        "north",
      );
    }

    const state = engine.getState();
    expect(state.cards[eligible.perona]?.zone).toBe("character");
    expect(state.cards[eligible.absalom]?.zone).toBe("trash");
    expect(state.cards[eligible.hogback]?.zone).toBe("trash");
    expect(state.cards[excluded.absalom]?.zone).toBe("trash");
    expect(state.cards[excluded.hogback]?.zone).toBe("trash");
    expect(state.cards[excluded.perona]?.zone).toBe("trash");
  });

  test("[Trigger] does nothing with Life well above the threshold", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      // 4 Life -> 3 once this card leaves. 3 is clear of the line in a way 1 is not: at exactly 1
      // remaining, `lte 1` and `gte 1` both hold.
      { life: [op16GeckoMoria105, op01Sai012, op01Sai012, op01Sai012], trash: TRASH },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const moriaId = engine.findCardInZone("north", "life", op16GeckoMoria105);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(pendingIntents(engine)).not.toContain("effectPlaySelection");
    expect(engine.getState().cards[moriaId]?.zone).toBe("trash");
    expect(engine.getState().players.north.characterArea.filter(Boolean)).toHaveLength(0);
  });
});
