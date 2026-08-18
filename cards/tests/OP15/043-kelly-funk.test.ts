import { describe, expect, test } from "vite-plus/test";
import type { StageCard } from "@tcg/op-types";
import {
  op01Bellamy076,
  op02Smoker093,
  op04CorridaColiseum096,
  op15BobbyFunk050,
  op15KellyFunk043,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A Stage that shares the name -- the only card type a `play` action's own filters could ever
// need to exclude, since `candidatesForPlayAction` pre-narrows the pool to character-or-stage
// before any filter runs. It exists here to show the encoding's deliberate ABSENCE of a
// `cardCategory: "character"` filter is harmless in the real pool (no such printing exists) while
// still being an honest possibility. Nothing in the card text restricts [Bobby Funk] to a
// Character, so this Stage IS a legal target and the test asserts exactly that.
const bobbyFunkStage: StageCard = {
  ...op04CorridaColiseum096,
  id: "TEST-OP15-043-STAGE",
  canonicalId: "TEST-OP15-043-STAGE",
  name: "Bobby Funk",
  // `cardName()` reads i18n.en.name, not the top-level field -- both have to agree or the `name`
  // filter silently keeps matching the spread-from card.
  i18n: { en: { ...op04CorridaColiseum096.i18n.en, name: "Bobby Funk" } },
  effects: undefined,
};

registerCards([bobbyFunkStage]);

describe("OP15-043 Kelly Funk", () => {
  test("[On Play] plays [Bobby Funk] from hand, and nothing else", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15KellyFunk043, op15BobbyFunk050, op01Bellamy076],
        activeDon: 3,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bobbyId = engine.findCardInZone("south", "hand", op15BobbyFunk050);
    const otherNameId = engine.findCardInZone("south", "hand", op01Bellamy076);

    engine.playCard(op15KellyFunk043, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Kelly Funk's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([bobbyId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(otherNameId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [bobbyId] }, "south");

    const state = engine.getState();
    expect(state.players.south.characterArea).toContain(bobbyId);
    // Played BY the effect, so cost-3 Bobby costs nothing: the only DON!! rested are the 3 that
    // paid for Kelly herself. This is what separates "played" from "put into play at full price".
    expect(state.players.south.activeDon).toBe(0);
    expect(state.players.south.restedDon).toBe(3);
  });

  test("a Stage that carries the name is a legal target too -- the filter is the NAME", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op15KellyFunk043, bobbyFunkStage, op01Bellamy076],
        activeDon: 3,
      },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const stageId = engine.findCardInZone("south", "hand", bobbyFunkStage);

    engine.playCard(op15KellyFunk043, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (play?.kind !== "selectEntity") throw new Error("Expected Kelly Funk's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([stageId]);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [stageId] }, "south");
    expect(engine.getState().players.south.stageArea).toBe(stageId);
  });

  test("with no [Bobby Funk] in hand there is no prompt at all", () => {
    // An `upTo` target with zero legal candidates publishes nothing. Delete the `name` filter and
    // Bellamy becomes eligible, a prompt appears, and this goes red.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op02Smoker093, hand: [op15KellyFunk043, op01Bellamy076], activeDon: 3 },
      { leaderCardId: op02Smoker093 },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const otherNameId = engine.findCardInZone("south", "hand", op01Bellamy076);

    engine.playCard(op15KellyFunk043, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toContain(otherNameId);
  });
});
