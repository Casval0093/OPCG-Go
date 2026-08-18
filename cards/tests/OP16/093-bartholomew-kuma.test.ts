import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01MountainGod018,
  op03Nero087,
  op16BartholomewKuma093,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-093 Bartholomew Kuma", () => {
  test("draws 2, trashes the chosen 2, then gives a rested DON!! to the Leader or a Character", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16BartholomewKuma093, eb01Doma005],
      deck: [eb01Fourtricks025, eb01MountainGod018, eb01Doma005],
      character: [op03Nero087],
      activeDon: op16BartholomewKuma093.cost,
      // `donState: "rested"` draws from restedDon, NOT activeDon (effects/actions.ts reads
      // `player.restedDon` for that branch), so the DON!! this action hands out has to be
      // seeded separately from the DON!! that pays for Kuma.
      restedDon: 2,
    });
    const firstDrawId = engine.findCardInZone("south", "deck", eb01Fourtricks025);
    const secondDrawId = engine.findCardInZone("south", "deck", eb01MountainGod018);
    const characterId = engine.findCardInZone("south", "character", op03Nero087);

    engine.playCard(op16BartholomewKuma093, "south");
    const kumaId = engine.findCardInZone("south", "character", op16BartholomewKuma093);
    // Paying Kuma's own cost RESTS that DON!!, so restedDon has grown by 3 -- read it after the
    // play rather than assuming the fixture value still holds.
    const restedBefore = engine.getView("south").players.south.restedDon;
    expect(restedBefore).toBe(5);

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected Kuma's hand-trash choice.");
    expect(trash).toMatchObject({ min: 2, max: 2 });
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: [firstDrawId, secondDrawId] },
      "south",
    );

    const count = engine.pendingDecision("effectGiveDonCount", "south").steps[0];
    expect(count?.kind).toBe("chooseOption");
    if (count?.kind !== "chooseOption") throw new Error("Expected Kuma's DON!! count choice.");
    // "up to 1 rested DON!! card" -- the offer stops at 1 even though 5 rested DON!! are
    // available, which is what pins `count.amount` rather than merely `upTo`.
    expect(count.options.map((option) => option.id)).toEqual(["0", "1"]);
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const recipient = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(recipient?.kind).toBe("selectEntity");
    if (recipient?.kind !== "selectEntity") throw new Error("Expected Kuma's DON!! recipient.");
    // "your Leader or 1 of your Characters" -- all three, with no trait or name restriction.
    // This is the sibling of OP16-094 Ace's clause, which DOES carry one (ruling #1006).
    expect(recipient.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("south"), characterId, kumaId].sort(),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [characterId] }, "south");

    const view = engine.getView("south");
    expect(
      view.players.south.characters.find((card) => card?.instanceId === characterId)?.attachedDon,
    ).toBe(1);
    expect(view.players.south.restedDon).toBe(restedBefore - 1);
    expect(view.players.south.activeDon).toBe(0);
    expect(view.players.south.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([firstDrawId, secondDrawId]),
    );
    expect(view.prompts).toHaveLength(0);
  });

  test("may give the DON!! to the Leader, or none at all", () => {
    const engine = OnePieceTestEngine.create({
      hand: [op16BartholomewKuma093, eb01Doma005],
      deck: [eb01Fourtricks025, eb01MountainGod018, eb01Doma005],
      activeDon: op16BartholomewKuma093.cost,
      restedDon: 1,
    });

    engine.playCard(op16BartholomewKuma093, "south");
    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    if (trash?.kind !== "selectEntity") throw new Error("Expected Kuma's hand-trash choice.");
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: trash.candidates.slice(0, 2).map((candidate) => candidate.ref.id) },
      "south",
    );
    const restedBefore = engine.getView("south").players.south.restedDon;
    engine.resolveDecision("effectGiveDonCount", { optionId: "0" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.restedDon).toBe(restedBefore);
    expect(view.players.south.leader.attachedDon).toBe(0);
    expect(view.prompts).toHaveLength(0);
  });
});
