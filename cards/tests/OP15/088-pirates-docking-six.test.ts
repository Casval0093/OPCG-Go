import { describe, expect, test } from "vite-plus/test";
import {
  eb02MerryGo041,
  op01MonkeyDLuffy003,
  op01Sai012,
  op02Jinbe033,
  op02Usopp028,
  op04Sanji007,
  op15PiratesDockingSix088,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// op04Sanji007   cost 1, Character, [Alabasta Straw Hat Crew]  -- legal, and under the line, so a
//                                                                 `lte -> gte` mutation drops it
// op02Usopp028   cost 3, Character, [Film Straw Hat Crew]      -- kills delete filter:cost
// op01Sai012     cost 2, Character, [Happosui Army]            -- kills delete filter:trait
// eb02MerryGo041 cost 1, STAGE,     [Straw Hat Crew]           -- kills delete filter:cardCategory
const TRASH = [op04Sanji007, op02Usopp028, op01Sai012, eb02MerryGo041];

describe("OP15-088 Pirates Docking Six", () => {
  test('"+6 cost" applies on the field and not in hand', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        hand: [op15PiratesDockingSix088],
        character: [op15PiratesDockingSix088],
        deck: 10,
      },
      {},
    );
    const view = engine.getView("south").players.south;
    const onField = view.characters.find((card) => card !== null);
    const inHand = view.hand[0];

    // `zones: ["character"]` scopes the modifier to the field. `value: 6` is a single digit, so
    // mutation_check.py generates nothing for it -- 11 and 5 are hand-pinned here.
    expect(onField?.cost).toBe(11);
    expect(inHand?.cost).toBe(5);
  });

  test("ruling #924: the play may take one of the 3 cards this effect just milled", () => {
    // 可以. The mill resolves first, so a cost-2 [Straw Hat Crew] body sitting on top of the deck
    // is in the trash by the time the play action builds its pool.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        hand: [op15PiratesDockingSix088],
        deck: [op02Jinbe033, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
        trash: TRASH,
        activeDon: 6,
      },
      {},
    );
    const sanjiId = engine.findCardInZone("south", "trash", op04Sanji007);
    const usoppId = engine.findCardInZone("south", "trash", op02Usopp028);
    const saiId = engine.findCardInZone("south", "trash", op01Sai012);
    const merryGoId = engine.findCardInZone("south", "trash", eb02MerryGo041);
    const milledJinbeId = engine.findCardInZone("south", "deck", op02Jinbe033);

    engine.playCard(op15PiratesDockingSix088, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    expect(engine.getState().cards[milledJinbeId]?.zone).toBe("trash");

    const step = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected the play selection.");
    const candidateIds = step.candidates.map((candidate) => candidate.ref.id);

    expect([...candidateIds].sort()).toEqual([milledJinbeId, sanjiId].sort());
    expect(candidateIds).not.toContain(usoppId);
    expect(candidateIds).not.toContain(saiId);
    expect(candidateIds).not.toContain(merryGoId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [milledJinbeId] }, "south");

    expect(engine.getState().cards[milledJinbeId]?.zone).toBe("character");
  });

  test("a deck too short to pay the mill buys nothing", () => {
    // The mill is the printed COST, and `trashTopDeckCards` runs `thenActions` only when the full
    // requested amount moved -- so a 2-card deck mills nothing and plays nothing, rather than
    // milling what it can and playing anyway.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        hand: [op15PiratesDockingSix088],
        deck: [op01Sai012, op01Sai012],
        trash: TRASH,
        activeDon: 6,
      },
      {},
    );

    engine.playCard(op15PiratesDockingSix088, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const state = engine.getState();
    expect(state.players.south.deck).toHaveLength(2);
    expect(state.players.south.trash).toHaveLength(TRASH.length);
    expect(
      state.promptQueue.filter(
        (prompt) =>
          prompt.status === "pending" && prompt.resolutionContext?.intent === "effectPlaySelection",
      ),
    ).toHaveLength(0);
  });

  test('declining the [On Play] mills nothing -- it is a "may"', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        hand: [op15PiratesDockingSix088],
        deck: 10,
        activeDon: 6,
      },
      {},
    );

    engine.playCard(op15PiratesDockingSix088, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().players.south.deck).toHaveLength(10);
    expect(engine.getState().players.south.trash).toHaveLength(0);
  });
});
