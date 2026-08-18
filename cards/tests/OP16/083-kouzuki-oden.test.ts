import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01MountainGod018,
  op03Kumadori082,
  op05ItSAWasteOfHumanLife058,
  op05JohnGiant044,
  op12Issho082,
  op16KouzukiOden083,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-083 Kouzuki Oden", () => {
  test("only Character cards at cost 8 or more can pay the trash cost, and paying draws 2", () => {
    const engine = OnePieceTestEngine.create({
      hand: [
        op16KouzukiOden083,
        // Two eligible bodies, not one: a cost with a single eligible candidate auto-pays and
        // publishes no prompt, so the excluded candidates could not be observed at all.
        op12Issho082,
        op05JohnGiant044,
        // Exactly one step under the printed threshold on the cost axis that matters -- cost 4.
        // Included by a `lte 8` misreading and by a deleted cost filter.
        op03Kumadori082,
        // A cost-8 EVENT. It clears the cost filter and is excluded only by `cardCategory`.
        // candidatesForTrashFromHandCost scans the whole hand with no card-type restriction of
        // its own, so this is a genuine false positive without that filter.
        op05ItSAWasteOfHumanLife058,
      ],
      deck: [eb01Doma005, eb01Fourtricks025, eb01MountainGod018],
      activeDon: op16KouzukiOden083.cost,
    });
    const eligibleIds = [
      engine.findCardInZone("south", "hand", op12Issho082),
      engine.findCardInZone("south", "hand", op05JohnGiant044),
    ];
    const cheapCharacterId = engine.findCardInZone("south", "hand", op03Kumadori082);
    const eightCostEventId = engine.findCardInZone("south", "hand", op05ItSAWasteOfHumanLife058);
    const firstDrawId = engine.findCardInZone("south", "deck", eb01Doma005);
    const secondDrawId = engine.findCardInZone("south", "deck", eb01Fourtricks025);

    engine.playCard(op16KouzukiOden083, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Oden's hand-trash payment.");
    expect(cost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [...eligibleIds].sort(),
    );
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(cheapCharacterId);
    expect(cost.candidates.map((candidate) => candidate.ref.id)).not.toContain(eightCostEventId);
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [eligibleIds[0]!] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(eligibleIds[0]);
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([firstDrawId, secondDrawId]),
    );
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });

  test("declining the cost draws nothing even with a payable Character in hand", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16KouzukiOden083, op12Issho082],
      deck: [eb01Doma005, eb01Fourtricks025],
      activeDon: op16KouzukiOden083.cost,
    });
    const retainedId = engine.findCardInZone("south", "hand", op12Issho082);

    engine.playCard(op16KouzukiOden083, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual([retainedId]);
    expect(view.players.south.deckCount).toBe(2);
    expect(view.players.south.trash).toHaveLength(0);
    expect(view.prompts).toHaveLength(0);
  });

  test("[Blocker] can redirect an attack onto itself", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: eb01MountainGod018, playedOnTurn: 0 }] },
      { character: [op16KouzukiOden083] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", eb01MountainGod018);
    const odenId = engine.findCardInZone("north", "character", op16KouzukiOden083);
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    // Without `keywords: ["blocker"]` there is no such prompt and pendingDecision throws.
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Oden's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(odenId);
    engine.resolveDecision("battleBlocker", { selectedIds: [odenId] }, "north");

    const view = engine.getView("north");
    // 7000 attacker vs Oden's 6000: the block happened, the Leader took nothing, Oden died.
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(odenId);
  });
});
