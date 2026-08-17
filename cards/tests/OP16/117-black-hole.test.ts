import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb01MountainGod018,
  op01Carrot009,
  op01Speed104,
  op02Kingdew006,
  op03Namule007,
  op09AvaloPizarro082,
  op12Issho082,
  op14eb04Kuroobi045,
  op16BlackHole117,
  op16MarshallDTeach080,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// The engine's vanilla pool tops out at cost 8, so the body that must fall OUTSIDE "cost of 8 or
// less" has to be synthetic. It is spread from op12Issho082 (a genuinely vanilla cost-8, 10000
// Character) with nothing changed but the cost, so it differs from the eligible cost-8 body in
// exactly the property under test.
const costNineCharacter: CharacterCard = {
  ...op12Issho082,
  id: "TEST-OP16-117-COST-9",
  canonicalId: "TEST-OP16-117-COST-9",
  name: "Nine Cost Issho",
  cost: 9,
  i18n: { en: { ...op12Issho082.i18n.en, name: "Nine Cost Issho" } },
};

registerCards([costNineCharacter]);

// op01Carrot009 and op01Speed104 have a `trigger:` effect block and nothing else, so they satisfy
// `hasTrigger` while contributing nothing when trashed from hand as a cost. op03Namule007 has no
// [Trigger] at all. op14eb04Kuroobi045 prints "[On K.O.] Draw 1 card", which is what makes the
// negation observable.

describe("OP16-117 Black Hole", () => {
  test("[Main] trashes a [Trigger] card to negate an opponent Character of cost 8 or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16MarshallDTeach080,
        // Two Trigger cards, because a cost with one eligible candidate auto-pays and publishes no
        // prompt at all (cards/ENCODING.md), leaving the excluded card unobservable.
        hand: [op16BlackHole117, op01Carrot009, op01Speed104, op03Namule007],
        character: [{ card: eb01MountainGod018, playedOnTurn: 0 }],
        activeDon: 2,
      },
      {
        character: [
          { card: op14eb04Kuroobi045, rested: true },
          op12Issho082,
          costNineCharacter,
          op09AvaloPizarro082,
        ],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const carrotId = engine.findCardInZone("south", "hand", op01Carrot009);
    const speedId = engine.findCardInZone("south", "hand", op01Speed104);
    const namuleHandId = engine.findCardInZone("south", "hand", op03Namule007);
    const kuroobiId = engine.findCardInZone("north", "character", op14eb04Kuroobi045);
    const isshoId = engine.findCardInZone("north", "character", op12Issho082);
    const costNineId = engine.findCardInZone("north", "character", costNineCharacter);

    engine.playCard(op16BlackHole117, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(payment?.kind).toBe("payCost");
    if (payment?.kind !== "payCost") throw new Error("Expected the Trigger-card cost.");
    expect(payment.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [carrotId, speedId].sort(),
    );
    expect(payment.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleHandId);
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [carrotId] }, "south");

    const negate = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (negate?.kind !== "selectEntity") throw new Error("Expected the negation target choice.");
    // The cost-8 Issho is ON the line and eligible; its cost-9 twin is not. Both are otherwise the
    // same card, so nothing but the number separates them.
    expect(negate.candidates.map((candidate) => candidate.ref.id)).toContain(isshoId);
    expect(negate.candidates.map((candidate) => candidate.ref.id)).not.toContain(costNineId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kuroobiId] }, "south");

    // Kuroobi's "[On K.O.] Draw 1 card" is what makes the negation observable: K.O. it and the
    // opponent's hand stays empty. Same proof as
    // packages/engine/tests/cards/events/op14-096-ground-death.test.ts.
    engine.declareAttack(
      engine.findCardInZone("south", "character", eb01MountainGod018),
      kuroobiId,
      "south",
    );
    const view = engine.getView("north");
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(kuroobiId);
    expect(view.players.north.hand).toHaveLength(0);
  });

  test("[Trigger] adds up to 1 [Blackbeard Pirates] type card from your trash to your hand", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16MarshallDTeach080,
        life: [op16BlackHole117, eb01Doma005, eb01Doma005, eb01Doma005],
        // op09AvaloPizarro082 carries the "Blackbeard Pirates" trait; op03Namule007 does not.
        trash: [op09AvaloPizarro082, op03Namule007],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const pizarroId = engine.findCardInZone("north", "trash", op09AvaloPizarro082);
    const namuleId = engine.findCardInZone("north", "trash", op03Namule007);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const retrieve = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (retrieve?.kind !== "selectEntity") throw new Error("Expected the trash retrieval choice.");
    expect(retrieve.candidates.map((candidate) => candidate.ref.id)).toEqual([pizarroId]);
    expect(retrieve.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [pizarroId] }, "north");

    expect(engine.getState().players.north.hand).toContain(pizarroId);
  });
});
