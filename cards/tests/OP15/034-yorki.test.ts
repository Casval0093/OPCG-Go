import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op02Brook040,
  op02Kingdew006,
  op02Smoker093,
  op03Namule007,
  op15Brook022,
  op15Yorki034,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The only way to reach Yorki's [On Play] on the OPPONENT's turn, which is the only board on which
// the printed [Your Turn] gate is observable at all: an own Character that plays a cheap body out
// of hand when the opponent declares an attack.
const opponentTurnPlayer: CharacterCard = {
  ...op03Namule007,
  id: "TEST-OP15-034-ONATTACK-PLAY",
  canonicalId: "TEST-OP15-034-ONATTACK-PLAY",
  name: "Test Opponent Turn Player",
  i18n: { en: { ...op03Namule007.i18n.en, name: "Test Opponent Turn Player" } },
  effects: {
    effects: [
      {
        trigger: "onOpponentAttack",
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "cost", comparison: "lte", value: 1 }],
          },
        ],
      },
    ],
  },
};

registerCards([opponentTurnPlayer]);

// op15Brook022 is the only Leader named Brook; op02Brook040 is a 5000-power Character named Brook.
// Both are needed: "[Brook] cards" spans Leader and Character, and neither zone can stand in for
// the other. op03Namule007 is the same-shape body with the wrong name.
function yorkiBoard() {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op15Brook022,
      character: [{ card: op02Brook040 }, { card: op03Namule007 }],
      hand: [op15Yorki034],
      activeDon: 1,
    },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function characterPower(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("south")
    .players.south.characters.find((card) => card?.instanceId === instanceId)?.power;
}

describe("OP15-034 Yorki", () => {
  test("[On Play] boosts a [Brook] Character by exactly +2000, and only for this turn", () => {
    const engine = yorkiBoard();
    const brookId = engine.findCardInZone("south", "character", op02Brook040);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(op15Yorki034, "south");

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(step?.kind).toBe("selectEntity");
    if (step?.kind !== "selectEntity") throw new Error("Expected a power target selection.");
    const candidates = step.candidates.map((candidate) => candidate.ref.id);
    // The Leader is in the pool -- a `zones: ["character"]` encoding would drop it. Namule is a
    // 3-cost/5000 vanilla body exactly like Brook apart from its name, so it kills
    // `delete filter:name`.
    expect(candidates.sort()).toEqual([engine.leader("south"), brookId].sort());
    expect(candidates).not.toContain(namuleId);
    expect(step.max).toBe(1);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [brookId] }, "south");

    // A `thisTurn` modifier is readable straight off the projection, so the magnitude is pinned as
    // an exact number rather than inferred from a battle outcome.
    expect(characterPower(engine, brookId)).toBe(7000);
    expect(characterPower(engine, namuleId)).toBe(5000);

    engine.endTurn("south");
    expect(characterPower(engine, brookId)).toBe(5000);
  });

  test("the [Brook] LEADER is a legal target too", () => {
    const engine = yorkiBoard();

    engine.playCard(op15Yorki034, "south");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    expect(engine.getView("south").players.south.leader.power).toBe(7000);
    engine.endTurn("south");
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("[Your Turn]: played during the OPPONENT's turn, the [On Play] grants nothing", () => {
    // The A/B against the first test: same card, same targets, the only difference is whose turn
    // it is. Without the `turn: "your"` condition the Brook body would be at 7000 here.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op15Brook022,
        character: [{ card: opponentTurnPlayer }, { card: op02Brook040 }],
        hand: [op15Yorki034],
        activeDon: 1,
      },
      {
        leaderCardId: op02Smoker093,
        character: [{ card: op02Kingdew006, playedOnTurn: 0 }],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const brookId = engine.findCardInZone("south", "character", op02Brook040);
    const attackerId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("south"), "north");
    engine.resolveDecision(
      "effectPlaySelection",
      { selectedIds: [engine.findCardInZone("south", "hand", op15Yorki034)] },
      "south",
    );

    // Yorki really did enter play on the opponent's turn -- otherwise "no boost" would just mean
    // "the fixture never fired".
    expect(engine.findCardInZone("south", "character", op15Yorki034)).toBeTruthy();
    expect(characterPower(engine, brookId)).toBe(5000);
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
    // `promptQueue` retains resolved prompts, so filter for pending ones by name rather than
    // asserting the queue is empty (the battle is still in flight).
    expect(
      engine
        .getState()
        .promptQueue.filter(
          (prompt) =>
            prompt.kind === "choice" &&
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectTargetSelection",
        ),
    ).toHaveLength(0);
  });
});
