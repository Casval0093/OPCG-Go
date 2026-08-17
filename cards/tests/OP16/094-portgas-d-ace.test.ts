import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  eb01Fourtricks025,
  op02KinEmon025,
  op03Nero087,
  op12Issho082,
  op12KinEmon025,
  op16PortgasDAce094,
} from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-094 Portgas.D.Ace", () => {
  test("[On K.O.] makes the controller's opponent trash 2 cards of their own choosing", () => {
    const engine = OnePieceTestEngine.create(
      {
        // South is the one who will be trashing: Ace belongs to north, so "your opponent" -- as
        // measured from Ace's controller -- is south, and `chosenBy` being omitted means the
        // hand's owner picks. Getting `player` backwards here would trash north's hand instead.
        character: [{ card: op12Issho082, playedOnTurn: 0 }],
        hand: [eb01Doma005, eb01Fourtricks025, op03Nero087],
      },
      {
        character: [{ card: op16PortgasDAce094, rested: true, playedOnTurn: 0 }],
        hand: [eb01Doma005, eb01Fourtricks025],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op12Issho082);
    const aceId = engine.findCardInZone("north", "character", op16PortgasDAce094);

    // 10000 into Ace's 5000: a real battle K.O.
    engine.declareAttack(attackerId, aceId, "south");
    // North holds counter-capable cards, so the counter step opens before damage is resolved.
    // Declining it is what lets the battle finish and Ace's [On K.O.] fire.
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "south").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected south's forced hand trash.");
    expect(trash).toMatchObject({ min: 2, max: 2 });
    expect(trash.candidates).toHaveLength(3);
    engine.resolveDecision(
      "effectTrashFromHandSelection",
      { selectedIds: trash.candidates.slice(0, 2).map((candidate) => candidate.ref.id) },
      "south",
    );

    const view = engine.getView("south");
    expect(view.players.south.hand).toHaveLength(1);
    expect(view.players.south.trash).toHaveLength(2);
    // North's own hand is untouched.
    expect(view.players.north.handCount).toBe(2);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(aceId);
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #1006: the rested DON!! may only go to a [Land of Wano] Leader or Character, once per turn", () => {
    const engine = OnePieceTestEngine.create({
      // A [Land of Wano] Leader, so the Leader is itself a legal recipient and `zones:
      // ["leader", ...]` is exercised rather than assumed.
      leaderCardId: op02KinEmon025,
      // op03Nero087 is CP9: ruling #1006 says 不能 -- a Character without the trait cannot be
      // given the DON!!. It is the only fixture here that a deleted trait filter would admit.
      character: [op16PortgasDAce094, op12KinEmon025, op03Nero087],
      restedDon: 2,
    });
    const aceId = engine.findCardInZone("south", "character", op16PortgasDAce094);
    const wanoCharacterId = engine.findCardInZone("south", "character", op12KinEmon025);
    const nonWanoId = engine.findCardInZone("south", "character", op03Nero087);

    engine.activateEffect(aceId, "activateMain", "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const recipient = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(recipient?.kind).toBe("selectEntity");
    if (recipient?.kind !== "selectEntity") throw new Error("Expected Ace's DON!! recipient.");
    const ids = recipient.candidates.map((candidate) => candidate.ref.id);
    // Ace itself is [Land of Wano], so it is a legal recipient too.
    expect(ids.sort()).toEqual([engine.leader("south"), aceId, wanoCharacterId].sort());
    expect(ids).not.toContain(nonWanoId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [wanoCharacterId] }, "south");

    const view = engine.getView("south");
    expect(
      view.players.south.characters.find((card) => card?.instanceId === wanoCharacterId)
        ?.attachedDon,
    ).toBe(1);
    expect(view.players.south.restedDon).toBe(1);
    // [Once Per Turn]: a rested DON!! is still available, so the only thing stopping a second
    // activation is the flag. Deleting `oncePerTurn: true` breaks nothing else in this file.
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === aceId,
      ),
    ).toBe(false);
    expect(view.prompts).toHaveLength(0);
  });
});
