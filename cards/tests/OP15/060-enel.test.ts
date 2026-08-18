import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Atmos003,
  op03Namule007,
  op15Enel060,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A minimal opponent removal source (the op07-042-gecko-moria technique): a 0-cost body whose
// [On Play] bounces one of the opponent's Characters. `cannotBeRemoved` is enforced by dropping
// the protected card out of the candidate pool (actionTargetIsEligible, effects/actions.ts), so
// the candidate list is exactly where the protection is observable.
const bouncer: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-060-BOUNCER",
  canonicalId: "TEST-OP15-060-BOUNCER",
  name: "Test Enel Bouncer",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
          },
        ],
      },
    ],
  },
};

registerCards([bouncer]);

function enelOnField(activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      // op03Namule007 is vanilla; it is the control body that stays bounceable at every DON!!
      // count, so "the candidate list is empty" can never be the reason a test goes green.
      character: [op15Enel060, op03Namule007],
      activeDon,
      donDeckCount: 10 - activeDon,
    },
    { leaderCardId: op16PortgasDAce001, hand: [bouncer] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

function powerOf(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === instanceId)?.power;
}

describe("OP15-060 Enel", () => {
  test("at 6 DON!! on the field: base 8000 reads exactly 10000 and an opponent's effect cannot remove him", () => {
    const engine = enelOnField(6);
    const enelId = engine.findCardInZone("south", "character", op15Enel060);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    // The exact number, not "more than 8000": `value 2000 -> 1000` is a mutant the tool
    // generates, and only an equality assertion kills it.
    expect(powerOf(engine, enelId)).toBe(10000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([namuleId]);
  });

  test("well below the threshold too: 3 DON!! still buys the +2000 and the protection", () => {
    // "6 or LESS" -- this is the case that tells `lte 6` from `gte 6`. At exactly 6 both
    // comparisons hold, so the boundary fixture alone would leave the mutant alive.
    const engine = enelOnField(3);
    const enelId = engine.findCardInZone("south", "character", op15Enel060);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    expect(powerOf(engine, enelId)).toBe(10000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([namuleId]);
  });

  test("at 7 DON!! neither half applies: 8000 power and bounceable", () => {
    const engine = enelOnField(7);
    const enelId = engine.findCardInZone("south", "character", op15Enel060);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    expect(powerOf(engine, enelId)).toBe(8000);

    engine.playCard(bouncer, "north");
    const pick = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (pick?.kind !== "selectEntity") throw new Error("Expected the bouncer's target choice.");
    expect(pick.candidates.map((candidate) => candidate.ref.id)).toEqual([enelId, namuleId]);
  });

  test("[Activate: Main] DON!! -1 grants [Blocker] into the opponent's turn, then trashes 1 from hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op15Enel060],
        // Two cards so the trash is a real choice: `trashFromHand` auto-resolves without a
        // prompt when the eligible pool is exactly the requested amount.
        hand: [op03Namule007, eb01Doma005],
        activeDon: 6,
        donDeckCount: 4,
      },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );
    const enelId = engine.findCardInZone("south", "character", op15Enel060);
    const doomedId = engine.findCardInZone("south", "hand", eb01Doma005);

    engine.activateEffect(enelId, "activateMain", "south");
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [doomedId] }, "south");

    let state = engine.getState();
    // DON!! -1 is a `returnDon` cost: the DON!! leaves the field for the DON!! deck. `restDon`
    // would leave the field count at 6 and the deck at 4 -- assert both or the two are
    // indistinguishable.
    expect(state.players.south).toMatchObject({ activeDon: 5, restedDon: 0, donDeckCount: 5 });
    expect(state.players.south.trash).toContain(doomedId);
    expect(state.players.south.hand).not.toContain(doomedId);

    engine.endTurn("south");
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      engine.leader("south"),
      "north",
    );

    // [Blocker] has no projected field, so it is proven functionally -- and doing it on the
    // opponent's turn pins `untilEndOfOpponentNextEndPhase` at the same time.
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Enel's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(enelId);
  });

  test("ruling #904: with an empty hand the activation still grants [Blocker]", () => {
    // 我方没有手牌的场合 ... 可以. This is why the trash is an ACTION and not a `trashFromHand`
    // cost -- as a cost, `canPayCosts` would reject the activation outright.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op15Enel060],
        hand: [],
        activeDon: 6,
        donDeckCount: 4,
      },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );
    const enelId = engine.findCardInZone("south", "character", op15Enel060);

    engine.activateEffect(enelId, "activateMain", "south");
    // Nothing to trash and nothing to choose: the action no-ops rather than stalling.
    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().players.south).toMatchObject({ activeDon: 5, donDeckCount: 5 });

    engine.endTurn("south");
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      engine.leader("south"),
      "north",
    );

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Enel's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(enelId);
  });

  test("without the activation Enel does not block", () => {
    // The control for the two tests above: [Blocker] is granted by the [Activate: Main], not
    // printed, so "the blocker prompt appeared" only means something next to this.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op16PortgasDAce001, character: [op15Enel060], activeDon: 6, donDeckCount: 4 },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );

    engine.endTurn("south");
    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      engine.leader("south"),
      "north",
    );

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" && prompt.resolutionContext?.intent === "battleBlocker",
        ),
    ).toBe(false);
  });
});
