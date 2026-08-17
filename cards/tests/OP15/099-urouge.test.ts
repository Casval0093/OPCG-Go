import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02RoronoaZoro043,
  op03Namule007,
  op05Enel098,
  op11Bartolomeo055,
  op15Urouge099,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Vanilla hand fixtures. Two [Supernovas] bodies, because a cost with exactly one eligible
// candidate auto-pays and publishes no prompt at all -- the excluded card would then be
// unobservable. op01Sai012 (Happosui Army) is the exclusion.
//   op02RoronoaZoro043  "Film Straw Hat Crew Supernovas"  -- concatenated traits, needs `includes`
//   op11Bartolomeo055   "Supernovas Dressrosa"
const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

function urougeOnPlay(hand: PlayerFixture["hand"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand, activeDon: 6 },
    {},
    SOUTH_ATTACKS,
  );
}

describe("OP15-099 Urouge", () => {
  test("[On Play] trashing a [Supernovas] card grants [Rush], proven by attacking the turn it is played", () => {
    const engine = urougeOnPlay([op15Urouge099, op02RoronoaZoro043, op11Bartolomeo055, op01Sai012]);
    const zoroId = engine.findCardInZone("south", "hand", op02RoronoaZoro043);
    const bartoId = engine.findCardInZone("south", "hand", op11Bartolomeo055);
    const saiId = engine.findCardInZone("south", "hand", op01Sai012);

    engine.playCard(op15Urouge099, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(payment?.kind).toBe("payCost");
    if (payment?.kind !== "payCost") throw new Error("Expected a cost payment step.");
    // Only the two [Supernovas] cards are payable; Sai is not. Drop the trait filter and this
    // list grows to three.
    expect(payment.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [zoroId, bartoId].sort(),
    );
    expect(payment.candidates.map((candidate) => candidate.ref.id)).not.toContain(saiId);

    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [zoroId] }, "south");

    // The functional proof of the grant: Urouge was played this turn, so without [Rush] the
    // engine rejects the attack outright.
    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);
    const attack = engine.exec({
      type: "declareAttack",
      seat: "south",
      attackerId: urougeId,
      targetId: engine.leader("north"),
    });
    expect(attack.accepted).toBe(true);
  });

  test('declining the cost leaves Urouge unable to attack -- the grant really is behind the "may"', () => {
    const engine = urougeOnPlay([op15Urouge099, op02RoronoaZoro043, op11Bartolomeo055]);

    engine.playCard(op15Urouge099, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: urougeId,
        targetId: engine.leader("north"),
      }).reason,
    ).toBe("The selected attacker cannot attack.");
  });

  test("[Activate: Main] turns the top Life card face-down to hand a rested DON!! to a Character", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Urouge099, playedOnTurn: 0 }, op03Namule007],
        // The cost is `faceUp: false` -- it turns a face-UP card DOWN -- and fixture Life cards
        // default to face-down, so the top one has to be seeded face-up for the cost to exist.
        life: [{ card: op01Sai012, faceUp: true }, op01Sai012, op01Sai012],
        activeDon: 2,
        restedDon: 3,
      },
      {},
      SOUTH_ATTACKS,
    );
    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.activateEffect(urougeId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    const state = engine.getState();
    // `donState: "rested"` draws from restedDon, not activeDon: swap it and both numbers move.
    expect(state.cards[namuleId]?.attachedDon).toBe(1);
    expect(state.players.south.restedDon).toBe(2);
    expect(state.players.south.activeDon).toBe(2);
    // The cost really flipped the card, so the ability cannot be used twice off one face-up card.
    expect(state.cards[state.players.south.life[0] ?? ""]?.faceUp).toBe(false);
    expect(state.players.south.life).toHaveLength(3);
  });

  test("ruling #934: the [Activate: Main] cannot be paid when the top Life card is already face-down", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Urouge099, playedOnTurn: 0 }, op03Namule007],
        // Face-down is the fixture default -- exactly the board ruling #934 asks about (不可以).
        life: 3,
        restedDon: 3,
      },
      {},
      SOUTH_ATTACKS,
    );
    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: urougeId,
        trigger: "activateMain",
      }).reason,
    ).toBe("The activation costs cannot be paid.");
  });

  test("ruling #934: the [Activate: Main] cannot be paid at 0 Life cards", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Urouge099, playedOnTurn: 0 }, op03Namule007],
        life: 0,
        restedDon: 3,
      },
      {},
      SOUTH_ATTACKS,
    );
    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: urougeId,
        trigger: "activateMain",
      }).reason,
    ).toBe("The activation costs cannot be paid.");
  });

  test("[Activate: Main] can hand the DON!! to the Leader, not only a Character", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Urouge099, playedOnTurn: 0 }],
        life: [{ card: op01Sai012, faceUp: true }, op01Sai012],
        restedDon: 2,
      },
      {},
      SOUTH_ATTACKS,
    );
    const urougeId = engine.findCardInZone("south", "character", op15Urouge099);

    engine.activateEffect(urougeId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected a target selection.");
    // "your Leader OR 1 of your Characters" -- drop "leader" from the zones and this goes red.
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toContain(
      engine.leader("south"),
    );

    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );
    expect(engine.getState().cards[engine.leader("south")]?.attachedDon).toBe(1);
  });
});
