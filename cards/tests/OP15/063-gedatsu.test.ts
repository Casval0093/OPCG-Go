import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Atmos003,
  op03Corgy083,
  op03Namule007,
  op03Spandam086,
  op15Gedatsu063,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The [On K.O.] is driven by a real battle K.O.: north's 6000 Atmos runs over a rested Gedatsu.
// south's hand stays empty -- a defender holding cards opens a battleCounter step first, which
// is a common way for a copied-in [On K.O.] test to fail on a prompt that has nothing to do
// with the card.
//
// north's K.O. candidates, chosen to pin all three of the tool's mutants on `power lte 2000`:
//   op03Corgy083   0 power   -- below the line, so `lte -> gte` drops it
//   op03Spandam086 2000      -- exactly on the line, so `value 2000 -> 1000` drops it
//   eb01Doma005    3000      -- above the line, so deleting the filter lets it in
// All three are inert once placed on the field ([On Play]-only or vanilla).
function gedatsuKod(activeDon: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [{ card: op15Gedatsu063, rested: true }],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    {
      leaderCardId: op16PortgasDAce001,
      character: [
        { card: op02Atmos003, playedOnTurn: 0 },
        op03Corgy083,
        op03Spandam086,
        eb01Doma005,
      ],
    },
    { firstPlayer: "south", activeSeat: "north" },
  );
  engine.declareAttack(
    engine.findCardInZone("north", "character", op02Atmos003),
    engine.findCardInZone("south", "character", op15Gedatsu063),
    "north",
  );
  return engine;
}

describe("OP15-063 Gedatsu", () => {
  test("[On Play] DON!! -1: paying returns a DON!! to the DON!! deck and draws exactly 1", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Gedatsu063],
        deck: [op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const topId = engine.getState().players.south.deck[0];

    engine.playCard(op15Gedatsu063, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    // Playing the card rested a DON!!, so two kinds are held and `returnDon` prompts. See
    // OP15-061 Ohm's test for the full note.
    engine.resolveDecision("effectCostReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 9 });
    expect(state.players.south.hand).toEqual([topId]);
  });

  test("[On Play] declining keeps the DON!! and draws nothing", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op15Gedatsu063],
        deck: [op03Namule007, op02Atmos003],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );

    engine.playCard(op15Gedatsu063, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south).toMatchObject({ activeDon: 1, restedDon: 1, donDeckCount: 8 });
    expect(state.players.south.hand).toHaveLength(0);
  });

  test("[On K.O.] at 6 DON!!: only opponent Characters at 2000 power or less are K.O.-able", () => {
    const engine = gedatsuKod(6);
    const zeroPowerId = engine.findCardInZone("north", "character", op03Corgy083);
    const onTheLineId = engine.findCardInZone("north", "character", op03Spandam086);

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Gedatsu's K.O. target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([
      zeroPowerId,
      onTheLineId,
    ]);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [onTheLineId] }, "south");
    expect(engine.getState().players.north.trash).toContain(onTheLineId);
  });

  test("[On K.O.] well under the threshold: 3 DON!! still fires", () => {
    const engine = gedatsuKod(3);
    const zeroPowerId = engine.findCardInZone("north", "character", op03Corgy083);

    const pick = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected Gedatsu's K.O. target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toContain(zeroPowerId);
  });

  test("[On K.O.] at 7 DON!! the effect never fires", () => {
    const engine = gedatsuKod(7);

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectTargetSelection",
        ),
    ).toBe(false);
    // Gedatsu really did die; the absent prompt is the gate, not a failed K.O. `characterArea`
    // carries `null` for empty slots, so filter before counting.
    expect(
      engine.getState().players.south.characterArea.filter((entry) => entry !== null),
    ).toHaveLength(0);
    expect(engine.getState().players.north.trash).toHaveLength(0);
  });
});
