import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Kingdew006,
  op02Smoker093,
  op05Enel098,
  op15Ryuma036,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The opponent board is deliberately three bodies that differ from each other on exactly one axis:
//   op02Atmos003  cost 4, RESTED  -- the only legal target
//   op02Atmos003  cost 4, ACTIVE  -- identical card, so `state: "rested"` is the only thing that
//                                    can exclude it (the "wrong about exactly one thing" fixture)
//   op02Kingdew006 cost 5, RESTED -- identical state, so `cost lte 4` is the only thing that can
//                                    exclude it
// Atmos at cost 4 sits exactly on the printed line, which is what pins the number itself.
function ryumaBoard() {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15Ryuma036], activeDon: 6 },
    {
      leaderCardId: op02Smoker093,
      character: [
        { card: op02Atmos003, rested: true },
        { card: op02Atmos003 },
        { card: op02Kingdew006, rested: true },
      ],
    },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function northCharacters(engine: OnePieceTestEngine) {
  const state = engine.getState();
  return state.players.north.characterArea
    .filter((entry): entry is string => entry !== null)
    .map((instanceId) => ({
      instanceId,
      cardId: state.cards[instanceId]?.cardId,
      rested: state.cards[instanceId]?.rested,
    }));
}

function koCandidates(engine: OnePieceTestEngine) {
  const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
  expect(step?.kind).toBe("selectEntity");
  if (step?.kind !== "selectEntity") throw new Error("Expected a K.O. target selection.");
  return step.candidates.map((candidate) => candidate.ref.id);
}

describe("OP15-036 Ryuma", () => {
  test("[On Play] offers only the rested cost-4 body", () => {
    const engine = ryumaBoard();
    const bodies = northCharacters(engine);
    const restedAtmos = bodies.find((b) => b.cardId === op02Atmos003.id && b.rested);
    const activeAtmos = bodies.find((b) => b.cardId === op02Atmos003.id && !b.rested);
    const restedKingdew = bodies.find((b) => b.cardId === op02Kingdew006.id);

    engine.playCard(op15Ryuma036, "south");

    const candidates = koCandidates(engine);
    // Exactly the rested cost-4 body. The active Atmos kills `delete filter:state`; the rested
    // cost-5 Kingdew kills `delete filter:cost` and `comparison lte -> gte` (under `gte 4` the
    // cost-5 body would qualify and the cost-4 one would still).
    expect(candidates).toEqual([restedAtmos?.instanceId]);
    expect(candidates).not.toContain(activeAtmos?.instanceId);
    expect(candidates).not.toContain(restedKingdew?.instanceId);

    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [restedAtmos?.instanceId ?? ""] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[restedAtmos?.instanceId ?? ""]?.zone).toBe("trash");
    expect(state.cards[activeAtmos?.instanceId ?? ""]?.zone).toBe("character");
    expect(state.cards[restedKingdew?.instanceId ?? ""]?.zone).toBe("character");
  });

  test("[When Attacking] is a SECOND block with its own copy of both filters", () => {
    // "[On Play]/[When Attacking]" is two EffectBlocks, each carrying its own `state` and `cost`
    // filters, so the [On Play] test above proves nothing about this one. Ryuma is placed on the
    // field directly (no [On Play]) and attacks.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Ryuma036, playedOnTurn: 0 }],
        activeDon: 6,
      },
      {
        leaderCardId: op02Smoker093,
        character: [
          { card: op02Atmos003, rested: true },
          { card: op02Atmos003 },
          { card: op02Kingdew006, rested: true },
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bodies = northCharacters(engine);
    const restedAtmos = bodies.find((b) => b.cardId === op02Atmos003.id && b.rested);
    const activeAtmos = bodies.find((b) => b.cardId === op02Atmos003.id && !b.rested);
    const restedKingdew = bodies.find((b) => b.cardId === op02Kingdew006.id);
    const ryumaId = engine.findCardInZone("south", "character", op15Ryuma036);

    engine.declareAttack(ryumaId, engine.leader("north"), "south");

    const candidates = koCandidates(engine);
    expect(candidates).toEqual([restedAtmos?.instanceId]);
    expect(candidates).not.toContain(activeAtmos?.instanceId);
    expect(candidates).not.toContain(restedKingdew?.instanceId);

    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [restedAtmos?.instanceId ?? ""] },
      "south",
    );
    expect(engine.getState().cards[restedAtmos?.instanceId ?? ""]?.zone).toBe("trash");
  });

  test("with no rested opponent Character the effect publishes nothing at all", () => {
    // An `upTo` target with zero legal candidates publishes NO prompt (GENERAL ruling #27), so
    // this is the shape that proves the filters gate the whole effect rather than producing an
    // empty list.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op05Enel098, hand: [op15Ryuma036], activeDon: 6 },
      { leaderCardId: op02Smoker093, character: [{ card: op02Atmos003 }] },
      { firstPlayer: "north", activeSeat: "south" },
    );

    engine.playCard(op15Ryuma036, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(
      engine.getState().cards[engine.findCardInZone("north", "character", op02Atmos003)]?.zone,
    ).toBe("character");
  });
});
