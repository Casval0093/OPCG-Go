import { describe, expect, test } from "vite-plus/test";
import { op01Urashima092, op03Nero087, op12Issho082, op16Otama081 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-081 Otama", () => {
  test("ruling #1003: an OPPONENT's cost-8 Character satisfies the condition, and the debuff is exactly -2000 for this turn", () => {
    const engine = OnePieceTestEngine.create(
      {
        // Otama (cost 2) is the only Character we control. Under the English reading -- "if YOU
        // have a Character with a cost of 8 or more" -- this activation would be illegal.
        // Ruling #1003 says it is legal, because the SC text scans the whole field.
        character: [op16Otama081, op03Nero087],
      },
      { character: [op12Issho082] },
    );
    const otamaId = engine.findCardInZone("south", "character", op16Otama081);
    const ownCharacterId = engine.findCardInZone("south", "character", op03Nero087);
    // op12Issho082: cost 8, power 10000. Both the enabler and the debuff target.
    const targetId = engine.findCardInZone("north", "character", op12Issho082);

    engine.activateEffect(otamaId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Otama's debuff target.");
    expect(selection).toMatchObject({ min: 0, max: 1 });
    // Proves `player: "opponent"`: our own cost-3 Nero is on the field and is not offered.
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([targetId]);
    expect(selection.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      ownCharacterId,
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");

    let view = engine.getView("south");
    // The cost was paid.
    expect(view.players.south.characters.find((card) => card?.instanceId === otamaId)?.rested).toBe(
      true,
    );
    // 10000 - 2000. Pins the magnitude, not just the recipient. `duration: "thisTurn"` (rather
    // than "thisBattle") is what makes this readable off the projection at all.
    expect(view.players.north.characters.find((card) => card?.instanceId === targetId)?.power).toBe(
      8000,
    );

    engine.endTurn("south");
    view = engine.getView("north");
    expect(view.players.north.characters.find((card) => card?.instanceId === targetId)?.power).toBe(
      10000,
    );
  });

  test("a cost-7 Character on either field is not enough: the activation is illegal at all", () => {
    const engine = OnePieceTestEngine.create(
      // Nothing on either field reaches cost 8, and op01Urashima092 sits exactly one step under
      // it at cost 7. This is the test that pins the threshold and the filter:
      //   * deleting the cost filter makes any Character satisfy the condition
      //   * flipping `gte` to `lte` makes cost 2/3/7 satisfy it
      // Both would make this activation legal, and both are what mutation_check.py perturbs.
      { character: [op16Otama081, op03Nero087] },
      { character: [op01Urashima092] },
    );
    const otamaId = engine.findCardInZone("south", "character", op16Otama081);

    expect(
      engine.expectFailure({
        type: "activateEffect",
        seat: "south",
        sourceInstanceId: otamaId,
        trigger: "activateMain",
      }).reason,
    ).toContain("The activation conditions are not met.");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === otamaId)?.rested).toBe(
      false,
    );
    expect(view.prompts).toHaveLength(0);
  });

  test("declining leaves Otama active and the opposing Character untouched", () => {
    const engine = OnePieceTestEngine.create(
      { character: [op16Otama081] },
      { character: [op12Issho082] },
    );
    const otamaId = engine.findCardInZone("south", "character", op16Otama081);
    const targetId = engine.findCardInZone("north", "character", op12Issho082);

    engine.activateEffect(otamaId, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === otamaId)?.rested).toBe(
      false,
    );
    expect(view.players.north.characters.find((card) => card?.instanceId === targetId)?.power).toBe(
      10000,
    );
    expect(view.prompts).toHaveLength(0);
  });
});
