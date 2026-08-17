import { describe, expect, test } from "vite-plus/test";
import {
  op02Kingdew006,
  op02Smoker093,
  op03Namule007,
  op13MonkeyDLuffy001,
  op16Sakazuki065,
} from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

// op02Smoker093 has the [Navy] type and an ability that cannot fire on its own
// ([DON!! x1] [Activate: Main]); op13MonkeyDLuffy001 is the "Straw Hat Crew Supernovas" default
// Leader and is the non-[Navy] control.
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function sakazukiInHand(leaderCardId: typeof op02Smoker093) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op16Sakazuki065], activeDon: op16Sakazuki065.cost },
    { character: [op02Kingdew006] },
    SOUTH_ACTS,
  );
}

function sakazukiOnField(leaderCardId: typeof op02Smoker093, activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [{ card: op16Sakazuki065, playedOnTurn: 0 }],
      activeDon,
      donDeckCount: 6,
    },
    {},
    SOUTH_ACTS,
  );
}

describe("OP16-065 Sakazuki", () => {
  test("[On Play] DON!! -1 takes an opponent Character to exactly -6000 until their next End Phase", () => {
    const engine = sakazukiInHand(op02Smoker093);
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.playCard(op16Sakazuki065, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Sakazuki's debuff target.");
    expect(choice).toMatchObject({ min: 0, max: 1 });
    expect(choice.candidates.map((candidate) => candidate.ref.id)).toEqual([kingdewId]);
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      engine.leader("north"),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [kingdewId] }, "south");

    // The magnitude is asserted as an exact number, not just "went down". `mutation_check.py`
    // never probes a negative `value:` (its numeric operator only matches unsigned literals), so
    // -6000 is pinned here by hand: 7000 - 6000 = 1000 to the digit.
    const power = () =>
      engine.getView("south").players.north.characters.find((c) => c?.instanceId === kingdewId)
        ?.power;
    expect(power()).toBe(1000);
    // DON!! -1 is a return, not a rest: 7 were spent playing him, and one of those left the field.
    expect(engine.getView("south").players.south).toMatchObject({ activeDon: 0, restedDon: 6 });

    // "until the end of your opponent's next End Phase": it survives the whole of north's turn...
    engine.endTurn("south");
    expect(power()).toBe(1000);
    // ...and only then wears off.
    engine.endTurn("north");
    expect(power()).toBe(7000);
  });

  test("[On Play] declining the DON!! -1 costs nothing and debuffs nothing", () => {
    const engine = sakazukiInHand(op02Smoker093);
    const kingdewId = engine.findCardInZone("north", "character", op02Kingdew006);

    engine.playCard(op16Sakazuki065, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const view = engine.getView("south");
    expect(view.players.north.characters.find((c) => c?.instanceId === kingdewId)?.power).toBe(
      7000,
    );
    // All 7 DON!! spent on Sakazuki are merely rested -- none was returned to the DON!! deck.
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 7 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[Activate: Main] with a [Navy] Leader rests 1 DON!! and adds up to 2 ACTIVE DON!!", () => {
    const engine = sakazukiOnField(op02Smoker093, 1);
    const sakazukiId = engine.findCardInZone("south", "character", op16Sakazuki065);

    engine.activateEffect(sakazukiId, "activateMain", "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected the DON!! count choice.");
    // Capped at 2 by the printed "up to 2", not by the 6 sitting in the DON!! deck.
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1", "2"]);
    engine.resolveDecision("effectAddDon", { optionId: "2" }, "south");

    const view = engine.getView("south");
    // The rest is the COST (1 active -> rested); the 2 added arrive ACTIVE, which is what
    // separates `state: "active"` from the "rest them" wording on Kuzan and Sengoku.
    expect(view.players.south).toMatchObject({ activeDon: 2, restedDon: 1, donDeckCount: 4 });
    expect(view.prompts).toHaveLength(0);
  });

  test("without a [Navy] Leader the cost is still paid and nothing is added", () => {
    // The [Navy] check sits after the cost colon, so it gates the payload rather than the
    // activation. If it were moved onto the block, this activation would be rejected outright
    // instead of resting a DON!! for nothing -- which is the observable difference.
    const engine = sakazukiOnField(op13MonkeyDLuffy001, 1);
    const sakazukiId = engine.findCardInZone("south", "character", op16Sakazuki065);

    engine.activateEffect(sakazukiId, "activateMain", "south");

    const view = engine.getView("south");
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 1, donDeckCount: 6 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[Once Per Turn]: a second activation is not offered even with DON!! to spare", () => {
    const engine = sakazukiOnField(op02Smoker093, 2);
    const sakazukiId = engine.findCardInZone("south", "character", op16Sakazuki065);

    engine.activateEffect(sakazukiId, "activateMain", "south");
    engine.resolveDecision("effectAddDon", { optionId: "0" }, "south");

    // 1 active DON!! is left, so the restDon cost is still payable and only `oncePerTurn` can
    // account for the command disappearing.
    expect(engine.getView("south").players.south.activeDon).toBe(1);
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === sakazukiId,
      ),
    ).toBe(false);
  });

  test("the debuff targets the opponent's Characters only", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op16Sakazuki065],
        character: [op03Namule007],
        activeDon: op16Sakazuki065.cost,
      },
      {},
      SOUTH_ACTS,
    );
    const ownBodyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(op16Sakazuki065, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // north has no Characters at all, so an `upTo` target with zero legal candidates publishes no
    // prompt (GENERAL ruling #27) -- and south's own body is provably not in the pool.
    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.characters.find((c) => c?.instanceId === ownBodyId)?.power).toBe(
      5000,
    );
  });
});
