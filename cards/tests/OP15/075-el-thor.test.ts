import { describe, expect, test } from "vite-plus/test";
import { op03Genzo046, op03Merry052, op15ElThor075, op15Enel058, op15Krieg001 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Note on test design: an `upTo` target with ZERO legal candidates publishes no prompt at all rather
// than an empty one, so a threshold cannot be pinned by asserting an empty candidate list -- there
// has to be an eligible body on the field for the prompt to exist. Merry (3000) and Genzo (4000)
// bracket the threshold from both sides in one list.
function elThor(leader = op15Enel058) {
  return OnePieceTestEngine.create(
    { leaderCardId: leader, hand: [op15ElThor075], activeDon: 1 },
    { character: [op03Merry052, op03Genzo046] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-075 El Thor", () => {
  test("[Main] buffs one of your cards +1000, then K.O.s only an opponent Character at 3000 power or less", () => {
    const engine = elThor();
    const merryId = engine.findCardInZone("north", "character", op03Merry052);
    const genzoId = engine.findCardInZone("north", "character", op03Genzo046);

    engine.playCard(op15ElThor075, "south");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    const ko = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(ko?.kind).toBe("selectEntity");
    if (ko?.kind !== "selectEntity") throw new Error("Expected El Thor's K.O. target.");
    // Merry is exactly 3000, so `lte 3000` includes it and `lt 3000` would not. Genzo is 4000, so a
    // relaxed threshold would add it. The list pins the comparison from both directions.
    expect(ko.candidates.map((candidate) => candidate.ref.id)).toEqual([merryId]);
    expect(ko.candidates.map((candidate) => candidate.ref.id)).not.toContain(genzoId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [merryId] }, "south");
    expect(engine.findCardInZone("north", "trash", op03Merry052)).toBe(merryId);
  });

  test("the +1000 lands on the chosen card of yours", () => {
    const engine = elThor();

    engine.playCard(op15ElThor075, "south");
    const buff = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(buff?.kind).toBe("selectEntity");
    if (buff?.kind !== "selectEntity") throw new Error("Expected El Thor's buff target.");
    // "your Leader or Character cards" -- the Leader is in the pool, and with no Characters of your
    // own it is the only candidate.
    expect(buff.candidates.map((candidate) => candidate.ref.id)).toEqual([engine.leader("south")]);
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    expect(engine.getView("south").players.south.leader.power).toBe(6000);
  });

  test("with a non-[Enel] Leader the [Main] does nothing and the DON!! is not paid", () => {
    const engine = elThor(op15Krieg001);

    engine.playCard(op15ElThor075, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.south.activeDon).toBe(1);
  });
});
