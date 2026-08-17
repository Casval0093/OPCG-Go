import { describe, expect, test } from "vite-plus/test";
import type { StageCard } from "@tcg/op-types";
import {
  op02Thatch007,
  op03Camie101,
  op05Enel098,
  op05UpperYard117,
  op06Genbo105,
  op08Wyper110,
  op15Raki112,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// No [Shandian Warrior] Stage is printed anywhere in the pool, so `cardCategory: "character"`
// would be untestable without one. `candidatesForPlayAction` pre-filters every `play` action to
// character-or-stage, which means a Stage -- not an Event -- is the only card type that can be a
// false positive here.
const shandianStage: StageCard = {
  ...op05UpperYard117,
  id: "TEST-OP15-112-SHANDIAN-STAGE",
  canonicalId: "TEST-OP15-112-SHANDIAN-STAGE",
  cost: 1,
  traits: ["Sky Island Shandian Warrior"],
};

registerCards([shandianStage]);

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

describe("OP15-112 Raki", () => {
  test("[On Play] offers only a [Shandian Warrior] Character costing 3 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        hand: [
          op15Raki112,
          op06Genbo105, // [Shandian Warrior], cost 3 -- exactly on the line
          op08Wyper110, // [Shandian Warrior], cost 4 -- one over
          op03Camie101, // cost 1, no [Shandian Warrior] trait
          shandianStage, // right trait, cheap enough, but a Stage
        ],
        activeDon: 4,
      },
      {},
      SOUTH_ACTS,
    );
    const genboId = engine.findCardInZone("south", "hand", op06Genbo105);
    const wyperId = engine.findCardInZone("south", "hand", op08Wyper110);
    const camieId = engine.findCardInZone("south", "hand", op03Camie101);
    const stageId = engine.findCardInZone("south", "hand", shandianStage);

    engine.playCard(op15Raki112, "south");

    const selection = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a play selection.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([genboId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(wyperId);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(camieId);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(stageId);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [genboId] }, "south");
    // It is played for free -- the DON!! spent was Raki's own cost of 4.
    expect(engine.getState().cards[genboId]?.zone).toBe("character");
    expect(engine.getState().players.south.activeDon).toBe(0);
  });

  test("[Blocker] is a real printed keyword, offered on the opponent's attack", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, character: [op15Raki112] },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const rakiId = engine.findCardInZone("south", "character", op15Raki112);
    const thatchId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(thatchId, engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a Blocker decision.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(rakiId);

    engine.resolveDecision("battleBlocker", { selectedIds: [rakiId] }, "south");
    expect(engine.getState().cards[rakiId]?.rested).toBe(true);
  });

  test("with nothing eligible in hand no play prompt appears", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15Raki112, op08Wyper110, op03Camie101], activeDon: 4 },
      {},
      SOUTH_ACTS,
    );

    engine.playCard(op15Raki112, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(
      engine
        .getState()
        .players.south.characterArea.filter((entry): entry is string => entry !== null),
    ).toHaveLength(1);
  });
});
