import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01MountainGod018,
  op05ItSAWasteOfHumanLife058,
  op05JohnGiant044,
  op12Issho082,
  op14eb04Oars101,
  op16NicoRobin092,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-092 Nico Robin", () => {
  // OP16-083 Kouzuki Oden prints the same clause, but its filters are a separate pair of
  // objects in a separate file: each has to be constrained by its own fixtures or one of them
  // can be deleted with every test still green.
  test("only Character cards at cost 8 or more can pay the trash cost, and paying draws 2", () => {
    const engine = OnePieceTestEngine.create({
      hand: [
        op16NicoRobin092,
        // Two eligible bodies so a real selection prompt appears at all.
        op12Issho082,
        op05JohnGiant044,
        // eb01MountainGod018 is cost 5 and eb01Fourtricks025 is cost 3: both under the line.
        eb01MountainGod018,
        eb01Fourtricks025,
        // A cost-8 Event -- clears the cost filter, excluded only by `cardCategory`.
        op05ItSAWasteOfHumanLife058,
      ],
      deck: [eb01Doma005, op14eb04Oars101, eb01Doma005],
      activeDon: op16NicoRobin092.cost,
    });
    const eligibleIds = [
      engine.findCardInZone("south", "hand", op12Issho082),
      engine.findCardInZone("south", "hand", op05JohnGiant044),
    ];
    const midCostId = engine.findCardInZone("south", "hand", eb01MountainGod018);
    const cheapId = engine.findCardInZone("south", "hand", eb01Fourtricks025);
    const eightCostEventId = engine.findCardInZone("south", "hand", op05ItSAWasteOfHumanLife058);
    const drawIds = [
      engine.findCardInZone("south", "deck", eb01Doma005),
      engine.findCardInZone("south", "deck", op14eb04Oars101),
    ];

    engine.playCard(op16NicoRobin092, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const cost = engine.pendingDecision("effectCostTrashFromHand", "south").steps[0];
    expect(cost?.kind).toBe("payCost");
    if (cost?.kind !== "payCost") throw new Error("Expected Robin's hand-trash payment.");
    const ids = cost.candidates.map((candidate) => candidate.ref.id);
    expect(ids.sort()).toEqual([...eligibleIds].sort());
    expect(ids).not.toContain(midCostId);
    expect(ids).not.toContain(cheapId);
    expect(ids).not.toContain(eightCostEventId);
    engine.resolveDecision("effectCostTrashFromHand", { selectedIds: [eligibleIds[1]!] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual([eligibleIds[1]]);
    expect(view.players.south.hand.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining(drawIds),
    );
    expect(view.players.south.deckCount).toBe(1);
    expect(view.prompts).toHaveLength(0);
  });

  test("declining draws nothing and trashes nothing", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16NicoRobin092, op12Issho082, op05JohnGiant044],
      deck: [eb01Doma005, eb01Doma005],
      activeDon: op16NicoRobin092.cost,
    });

    engine.playCard(op16NicoRobin092, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(2);
    expect(view.players.south.trash).toHaveLength(0);
    expect(view.players.south.deckCount).toBe(2);
    expect(view.prompts).toHaveLength(0);
  });
});
