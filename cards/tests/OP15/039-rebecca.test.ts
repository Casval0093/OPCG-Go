import { describe, expect, test } from "vite-plus/test";
import type { StageCard } from "@tcg/op-types";
import {
  eb03Viola030,
  op01Bellamy076,
  op03Namule007,
  op04CorridaColiseum096,
  op10BlueGilly054,
  op15Rebecca039,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// A [Dressrosa] Stage at cost exactly 3 has to be synthesised, because no printed card is one: the
// only two Dressrosa Stages in the whole catalog (OP04-096 Corrida Coliseum, OP15-057 Dressrosa
// Kingdom) both cost 1, and cost 1 fails the `cost eq 3` filter for a reason that has nothing to do
// with `cardCategory`. Without this card the `cardCategory: "character"` filter on the play action is
// unfalsifiable and mutation_check.py reports it as a survivor -- which it did.
//
// It must be a STAGE, not an Event: `candidatesForPlayAction` (effects/actions.ts) hard-filters every
// `play` candidate pool to `cardType === "stage" || "character"` BEFORE any `cardCategory` filter is
// consulted, so an Event can never reach this filter and a cheap-Event fixture would "pass"
// vacuously. See cards/ENCODING.md, OP16-029 gotcha.
const dressrosaStageAtCostThree: StageCard = {
  ...op04CorridaColiseum096,
  id: "TEST-OP15-039-DRESSROSA-STAGE-3",
  canonicalId: "TEST-OP15-039-DRESSROSA-STAGE-3",
  cost: 3,
};

registerCards([dressrosaStageAtCostThree]);

// Fixtures, all vanilla engine cards, chosen so the cost filter and the play filter can each be
// broken in isolation and caught:
//   op10BlueGilly054  Dressrosa, cost 3  -- the only thing that satisfies "cost of 3" + [Dressrosa]
//   op01Bellamy076    Dressrosa, cost 2  -- right trait, wrong cost (catches `eq` -> `lte`)
//   eb03Viola030      Dressrosa, cost 5  -- right trait, wrong cost the other way
//   op03Namule007     Whitebeard, cost 3 -- right cost, wrong trait

function rebecca(south: PlayerFixture): OnePieceTestEngine {
  return OnePieceTestEngine.create(
    { leaderCardId: op15Rebecca039, ...south },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-039 Rebecca", () => {
  test("this Leader cannot attack", () => {
    const engine = rebecca({});

    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: engine.leader("south"),
        targetId: engine.leader("north"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
  });

  test('ruling #893 plus the "cost of 3" boundary: the Character returned as a cost is immediately replayable, and nothing else in hand is', () => {
    // One test, two claims, because the same candidate list settles both:
    //  * #893 -- returning a cost-3 [Dressrosa] Character to hand as part of the cost and then
    //    playing that very card is legal (可以). It has to appear in the post-payment candidates.
    //  * "a cost of 3" is EXACTLY 3. Bellamy (2) and Viola (5) are both [Dressrosa] and both in hand,
    //    so an `lte 3` or `gte 3` encoding would widen this list and go red.
    const engine = rebecca({
      character: [op10BlueGilly054],
      hand: [op01Bellamy076, eb03Viola030],
    });
    const onFieldId = engine.findCardInZone("south", "character", op10BlueGilly054);

    // With exactly one eligible Character the return cost auto-pays and publishes no prompt -- the
    // engine only builds a cost selection when `candidates.length > amount` (cards/ENCODING.md,
    // OP16-002 gotcha). The dedicated cost-filter test below supplies a second candidate on purpose
    // so that prompt does appear.
    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    // Paying the cost rests the Leader and puts Blue Gilly in hand.
    expect(engine.getView("south").players.south.leader.rested).toBe(true);
    const returnedId = engine.findCardInZone("south", "hand", op10BlueGilly054);
    expect(returnedId).toBe(onFieldId);

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Rebecca's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([returnedId]);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [returnedId] }, "south");

    expect(engine.findCardInZone("south", "character", op10BlueGilly054)).toBe(returnedId);
  });

  test("the play is restricted to [Dressrosa] -- a cost-3 Character of another type does not qualify", () => {
    // Namule is cost 3 but Whitebeard Pirates. Drop the trait filter from the play action and this
    // goes red; the cost-boundary test above would not notice.
    const engine = rebecca({
      character: [op10BlueGilly054],
      hand: [op03Namule007],
    });
    const onFieldId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const namuleId = engine.findCardInZone("south", "hand", op03Namule007);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Rebecca's hand-play choice.");
    const candidateIds = play.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).not.toContain(namuleId);
    expect(candidateIds).toEqual([onFieldId]);
  });

  test("the play is restricted to Character cards -- a cost-3 [Dressrosa] Stage does not qualify", () => {
    const engine = rebecca({
      character: [op10BlueGilly054],
      hand: [dressrosaStageAtCostThree],
    });
    const onFieldId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const stageId = engine.findCardInZone("south", "hand", dressrosaStageAtCostThree);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    // The Stage satisfies [Dressrosa] and cost 3 on both other filters, so `cardCategory` is the only
    // thing keeping it out. Delete that filter and this goes red with the Stage in the candidates.
    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Rebecca's hand-play choice.");
    const candidateIds = play.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).not.toContain(stageId);
    expect(candidateIds).toEqual([onFieldId]);
  });

  test("the return cost is restricted to [Dressrosa] Characters", () => {
    // Needs TWO [Dressrosa] bodies, not one: with a single eligible candidate the cost auto-pays and
    // there is no candidate list to inspect, so a one-Dressrosa fixture would pass whether or not the
    // trait filter is present. With two eligible and one ineligible, dropping the cost's trait filter
    // widens the list to all three and this goes red.
    const engine = rebecca({
      character: [op10BlueGilly054, eb03Viola030, op03Namule007],
      hand: [],
    });
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const violaId = engine.findCardInZone("south", "character", eb03Viola030);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.activateEffect(engine.leader("south"), "activateMain", "south");

    // A cost selection projects as `payCost`, not `selectEntity` (projection.ts) -- it still carries
    // `candidates`/`min`/`max`, but the kind differs from an action's target selection.
    const returnCost = engine.pendingDecision("effectCostReturnCharacter", "south").steps[0];
    expect(returnCost?.kind).toBe("payCost");
    if (returnCost?.kind !== "payCost") throw new Error("Expected Rebecca's return cost.");
    const candidateIds = returnCost.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([blueGillyId, violaId]);
    expect(candidateIds).not.toContain(namuleId);
  });

  test("with no [Dressrosa] Character on field the cost cannot be paid and the effect is rejected", () => {
    const engine = rebecca({ character: [op03Namule007], hand: [op10BlueGilly054] });

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: engine.leader("south"),
        trigger: "activateMain",
      }).reason,
    ).toBe("The activation costs cannot be paid.");
    expect(engine.getView("south").players.south.leader.rested).toBe(false);
  });
});
