import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Kingdew006,
  op03Namule007,
  st30Mr3Galdino014,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function mr3Board() {
  return OnePieceTestEngine.create(
    {
      character: [
        st30Mr3Galdino014,
        op02Atmos003,
        op02Atmos003,
        { card: op03Namule007, attachedDon: 1 },
        op02Kingdew006,
      ],
      restedDon: 4,
    },
    { character: [op02Atmos003] },
  );
}

describe("ST30-014 Mr.3(Galdino)", () => {
  test("rests itself and gives 2 rested DON!! to each of 2 Characters with 6000 base power", () => {
    const engine = mr3Board();
    const mr3Id = engine.findCardInZone("south", "character", st30Mr3Galdino014);
    const atmosIds = engine
      .getState()
      .players.south.characterArea.filter((id): id is string => id !== null)
      .filter((id) => engine.getState().cards[id]?.cardId === op02Atmos003.id);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);
    const kingdewId = engine.findCardInZone("south", "character", op02Kingdew006);
    const opponentAtmosId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.activateEffect(mr3Id, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const targets = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(targets?.kind).toBe("selectEntity");
    if (targets?.kind !== "selectEntity") throw new Error("Expected Mr.3's 6000-base recipients.");
    expect(targets).toMatchObject({ min: 0, max: 2 });
    const candidateIds = targets.candidates.map((candidate) => candidate.ref.id);
    // Ruling #255: originally 6000, exactly. Namule prints 5000 (lte would admit it) and is
    // sitting at current 6000 from 1 attached DON!! (a power filter would admit it). Kingdew
    // prints 7000 (gte would admit it). North's Atmos is the opponent (player: "self").
    expect(candidateIds.sort()).toEqual([...atmosIds].sort());
    expect(candidateIds).not.toContain(namuleId);
    expect(candidateIds).not.toContain(kingdewId);
    expect(candidateIds).not.toContain(mr3Id);
    expect(candidateIds).not.toContain(opponentAtmosId);
    expect(candidateIds).not.toContain(engine.leader("south"));

    engine.resolveDecision("effectTargetSelection", { selectedIds: atmosIds }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === mr3Id)).toMatchObject({
      rested: true,
      attachedDon: 0,
    });
    for (const atmosId of atmosIds) {
      // Magnitude: each selected body gets exactly 2, not 1 (Chopper's amount) and not a
      // shared pool of 2. `distribution: "each"` is what makes that per-target.
      expect(
        view.players.south.characters.find((card) => card?.instanceId === atmosId)?.attachedDon,
      ).toBe(2);
    }
    expect(view.players.south.characters.find((card) => card?.instanceId === namuleId)?.attachedDon).toBe(
      1,
    );
    expect(
      view.players.south.characters.find((card) => card?.instanceId === kingdewId)?.attachedDon,
    ).toBe(0);
    expect(view.players.north.characters.find((card) => card?.instanceId === opponentAtmosId)?.attachedDon).toBe(
      0,
    );
    expect(view.players.south.restedDon).toBe(0);
    expect(view.prompts).toHaveLength(0);
  });

  test("may pay the rest cost and give no DON!!", () => {
    const engine = mr3Board();
    const mr3Id = engine.findCardInZone("south", "character", st30Mr3Galdino014);

    engine.activateEffect(mr3Id, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === mr3Id)).toMatchObject({
      rested: true,
      attachedDon: 0,
    });
    expect(view.players.south.restedDon).toBe(4);
    expect(view.prompts).toHaveLength(0);
  });

  test("may decline without resting itself or moving DON!!", () => {
    const engine = mr3Board();
    const mr3Id = engine.findCardInZone("south", "character", st30Mr3Galdino014);

    engine.activateEffect(mr3Id, "activateMain", "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.find((card) => card?.instanceId === mr3Id)).toMatchObject({
      rested: false,
      attachedDon: 0,
    });
    expect(view.players.south.restedDon).toBe(4);
    expect(view.prompts).toHaveLength(0);
  });

  test("an already-rested copy cannot pay its own cost", () => {
    const engine = OnePieceTestEngine.create({
      character: [{ card: st30Mr3Galdino014, playedOnTurn: 0, rested: true }],
      restedDon: 4,
    });
    const mr3Id = engine.findCardInZone("south", "character", st30Mr3Galdino014);

    const result = engine.expectFailure({
      type: "activateEffect",
      seat: "south",
      sourceInstanceId: mr3Id,
      trigger: "activateMain",
    });
    expect(result.reason).toBe("The activation costs cannot be paid.");
  });
});
