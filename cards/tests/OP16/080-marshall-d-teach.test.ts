import { describe, expect, test } from "vite-plus/test";
import {
  op01Carrot009,
  op01Speed104,
  op02Atmos003,
  op02Kingdew006,
  op03Namule007,
  op09AvaloPizarro082,
  op16MarshallDTeach080,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// `getLegalCommands` cannot be used to prove a *specific* prompt is absent: the defender always
// has a pending `battleCounter` prompt during a declared attack, so "no resolvePrompt is legal"
// is never true mid-battle. Scan the queue for the one intent instead.
function hasPendingIntent(engine: OnePieceTestEngine, intent: string, seat: "south" | "north") {
  return engine
    .getState()
    .promptQueue.some(
      (prompt) =>
        prompt.status === "pending" &&
        prompt.seat === seat &&
        prompt.resolutionContext?.intent === intent,
    );
}

// Fixtures, all genuinely vanilla or inert-in-hand pre-OP15 engine cards:
//   op09AvaloPizarro082  Blackbeard Pirates, cost 4, 6000  -- a legal redirect destination
//   op03Namule007        Whitebeard Pirates,  cost 3, 5000  -- the NON-Blackbeard body that must
//                                                              be excluded from the redirect, and
//                                                              a hand card with no [Trigger]
//   op02Atmos003         Whitebeard Pirates,  cost 4, 6000  -- opponent attacker
//   op02Kingdew006       Whitebeard Pirates,  cost 5, 7000  -- second attacker, big enough to
//                                                              K.O. Pizarro once the redirect is
//                                                              spent
//   op01Carrot009        cost 2, 3000, its ONLY effect block is a `trigger:` one ("Play this
//   op01Speed104         card") -- two cards that satisfy `hasTrigger`. A card in hand is inert,
//                                    and trashing it as a cost never resolves its Trigger, so
//                                    these contribute nothing but the property being filtered on.
//
// South is the attacker throughout: a south-Leader/Character attack needs
// `{ firstPlayer: "north", activeSeat: "south" }` (cards/ENCODING.md), which also puts Teach on
// north and makes it the opponent's turn from Teach's point of view -- the only window the
// [Opponent's Turn] cost bump applies in.

function teachDefending(
  northFixture: PlayerFixture,
  southCharacters: PlayerFixture["character"] = [{ card: op02Atmos003, playedOnTurn: 0 }],
) {
  return OnePieceTestEngine.create(
    { character: southCharacters },
    { leaderCardId: op16MarshallDTeach080, ...northFixture },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP16-080 Marshall.D.Teach", () => {
  test("[Opponent's Turn] all of your Characters gain +1 cost, and only then", () => {
    const engine = teachDefending({
      character: [op09AvaloPizarro082, op03Namule007],
    });
    const pizarroId = engine.findCardInZone("north", "character", op09AvaloPizarro082);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const costOf = (instanceId: string) =>
      engine
        .getView("north")
        .players.north.characters.find((card) => card?.instanceId === instanceId)?.cost;

    // "All of your Characters", not just the Blackbeard ones: Namule is a Whitebeard Pirates body
    // and still gets the bump. 4 -> 5 and 3 -> 4.
    expect(costOf(pizarroId)).toBe(5);
    expect(costOf(namuleId)).toBe(4);

    // Hand the turn back to Teach's own controller and the continuous effect switches off.
    engine.endTurn("south");
    expect(costOf(pizarroId)).toBe(4);
    expect(costOf(namuleId)).toBe(3);
  });

  test("redirects the attack to this Leader, and the Leader is a legal destination", () => {
    const engine = teachDefending({
      hand: [op01Carrot009, op01Speed104],
      // A rested Character is the only kind that can be attacked, so this is what the opponent
      // aims at; the redirect is what saves it.
      character: [{ card: op09AvaloPizarro082, rested: true }],
    });
    const attackerId = engine.findCardInZone("south", "character", op02Atmos003);
    const pizarroId = engine.findCardInZone("north", "character", op09AvaloPizarro082);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, pizarroId, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [engine.findCardInZone("north", "hand", op01Carrot009)] },
      "north",
    );

    const redirect = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    expect(redirect?.kind).toBe("selectEntity");
    if (redirect?.kind !== "selectEntity") throw new Error("Expected Teach's redirect target.");
    expect(redirect.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), pizarroId].sort(),
    );
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    // The 6000-power attacker now meets the 5000-power Leader instead of the 6000-power
    // Character: Life drops by 1 and Pizarro is untouched. Under a broken redirect the attack
    // would still resolve against Pizarro, whose 6000 ties the attacker's 6000 and dies.
    const view = engine.getView("north");
    expect(view.players.north.lifeCount).toBe(lifeBefore - 1);
    expect(view.players.north.characters.some((card) => card?.instanceId === pizarroId)).toBe(true);
  });

  test("only Blackbeard Pirates Characters (and the Leader) can be redirected to", () => {
    const engine = teachDefending({
      hand: [op01Carrot009, op01Speed104],
      character: [{ card: op09AvaloPizarro082, rested: true }, op03Namule007],
    });
    const attackerId = engine.findCardInZone("south", "character", op02Atmos003);
    const pizarroId = engine.findCardInZone("north", "character", op09AvaloPizarro082);

    engine.declareAttack(attackerId, pizarroId, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [engine.findCardInZone("north", "hand", op01Carrot009)] },
      "north",
    );

    const redirect = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (redirect?.kind !== "selectEntity") throw new Error("Expected Teach's redirect target.");
    // Namule is a Character of Teach's, on the field, and absent: the anyOf/groups filter is what
    // keeps it out. Asserting the EXACT set (rather than just "Namule is missing") is what also
    // kills the mirror-image mistake -- an empty filter group that would drop the Leader or drop
    // Pizarro instead.
    expect(redirect.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), pizarroId].sort(),
    );
  });

  test("the cost can only be paid with a card that has a [Trigger]", () => {
    const engine = teachDefending({
      // Two Trigger cards, because a cost with exactly one eligible candidate auto-pays and
      // publishes no prompt at all (cards/ENCODING.md) -- with one, the excluded card would be
      // unobservable and this test would pass whether or not the filter existed.
      hand: [op01Carrot009, op01Speed104, op03Namule007],
      character: [{ card: op09AvaloPizarro082, rested: true }],
    });
    const attackerId = engine.findCardInZone("south", "character", op02Atmos003);
    const pizarroId = engine.findCardInZone("north", "character", op09AvaloPizarro082);

    engine.declareAttack(attackerId, pizarroId, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "north").steps[0];
    // A cost selection projects as kind "payCost", not "selectEntity" (projection.ts).
    expect(payment?.kind).toBe("payCost");
    if (payment?.kind !== "payCost") throw new Error("Expected Teach's Trigger-card cost.");
    expect(payment.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [
        engine.findCardInZone("north", "hand", op01Carrot009),
        engine.findCardInZone("north", "hand", op01Speed104),
      ].sort(),
    );
  });

  test("[Once Per Turn]: a second attack in the same turn is not offered the redirect", () => {
    const engine = teachDefending(
      {
        hand: [op01Carrot009, op01Speed104],
        character: [{ card: op09AvaloPizarro082, rested: true }],
      },
      [
        { card: op02Atmos003, playedOnTurn: 0 },
        { card: op02Kingdew006, playedOnTurn: 0 },
      ],
    );
    const firstAttackerId = engine.findCardInZone("south", "character", op02Atmos003);
    const secondAttackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const pizarroId = engine.findCardInZone("north", "character", op09AvaloPizarro082);

    engine.declareAttack(firstAttackerId, pizarroId, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    engine.resolveDecision(
      "effectCostTrashFromHand",
      { selectedIds: [engine.findCardInZone("north", "hand", op01Carrot009)] },
      "north",
    );
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("north")] },
      "north",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    expect(hasPendingIntent(engine, "effectOptional", "north")).toBe(false);

    // Second attack of the same turn. Pizarro survived the first one (the redirect took it), so
    // it is still a rested, attackable body -- the trigger has a real second chance to fire.
    engine.declareAttack(secondAttackerId, pizarroId, "south");
    expect(hasPendingIntent(engine, "effectOptional", "north")).toBe(false);
    // ... and the used-up ability leaves Pizarro to die to the 5000-power attacker's tie.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    expect(
      engine.getView("north").players.north.characters.some(
        (card) => card?.instanceId === pizarroId,
      ),
    ).toBe(false);
  });
});
