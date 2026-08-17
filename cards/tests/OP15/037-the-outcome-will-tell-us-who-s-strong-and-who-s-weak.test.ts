import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op03Merry052,
  op15Krieg001,
  op15TheOutcomeWillTellUsWhoSStrongAndWhoSWeak037,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15TheOutcomeWillTellUsWhoSStrongAndWhoSWeak037;

describe("OP15-037 The Outcome Will Tell Us Who's Strong and Who's Weak", () => {
  test("[Main] looks at 5 and can only reveal an [East Blue] card, excluding a second copy of itself", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        hand: [CARD],
        activeDon: 1,
        // Two East Blue bodies, one non-East-Blue body, and a second copy of this very card -- the
        // last is what the `excludeName` filter has to keep out, and it is East Blue itself, so
        // without that filter it would be a legal reveal.
        deck: [op03Genzo046, op02Atmos003, op03Merry052, CARD, op02Atmos003],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const genzoId = engine.findCardInZone("south", "deck", op03Genzo046);
    const merryId = engine.findCardInZone("south", "deck", op03Merry052);
    const selfCopyId = engine.findCardInZone("south", "deck", CARD);

    engine.playCard(CARD, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(search?.kind).toBe("selectEntity");
    if (search?.kind !== "selectEntity") throw new Error("Expected the search selection.");
    const legalIds = search.candidates
      .filter((candidate) => candidate.legal)
      .map((candidate) => candidate.ref.id);
    expect(legalIds).toEqual([genzoId, merryId]);
    expect(legalIds).not.toContain(selfCopyId);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [genzoId] }, "south");
    expect(engine.findCardInZone("south", "hand", op03Genzo046)).toBe(genzoId);
  });

  test("[Trigger] draws 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Krieg001,
        life: [CARD, op03Genzo046, op03Genzo046, op03Genzo046],
        deck: [op03Genzo046, op03Merry052],
      },
      { character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(atmosId, engine.leader("south"), "north");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "south");

    // Activating a [Trigger] consumes the card -- it goes to the trash, it does NOT also join the
    // hand (GENERAL ruling #21: adding it to hand is the alternative to activating it). So the single
    // card in hand is the draw itself, and without the draw the hand would be empty.
    expect(engine.getView("south").players.south.hand).toHaveLength(1);
    expect(engine.findCardInZone("south", "trash", CARD)).toBeTruthy();
  });
});
