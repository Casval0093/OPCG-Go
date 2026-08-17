import { describe, expect, test } from "vite-plus/test";
import {
  eb01Doma005,
  op02Blugori084,
  op02Crocodile053,
  op02ImpelDown092,
  op02Kingdew006,
  op02Sphinx088,
  op03Namule007,
  op16PortgasDAce001,
  op16WeLlChangeThisMissionFromSneakyToFlashy059,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The five looked-at cards pin all three reveal filters independently:
//   op02Blugori084    Impel Down character, 3000  -- clear of the 6000 line, so `lte` cannot be
//                                                    mistaken for `gte`
//   op02Sphinx088     Impel Down character, 6000  -- ON the line; the only fixture that pins 6000
//   op02Crocodile053  Impel Down character, 7000  -- excluded by the power filter
//   op02ImpelDown092  Impel Down STAGE, cost 1    -- excluded by cardCategory. Its power is
//                                                    hard-zeroed by basePower(), so 0 <= 6000 and
//                                                    it would otherwise qualify.
//   op03Namule007     Whitebeard character, 5000  -- excluded by the trait filter

describe("OP16-059 We'll Change This Mission from Sneaky to Flashy!", () => {
  test("[Main] rests 7 DON!! and plays up to 2 Impel Down Characters of 6000 power or less", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16WeLlChangeThisMissionFromSneakyToFlashy059],
        deck: [
          op02Blugori084,
          op02Sphinx088,
          op02Crocodile053,
          op02ImpelDown092,
          op03Namule007,
          eb01Doma005,
        ],
        // 1 pays for the event itself, 7 pays the cost.
        activeDon: 8,
      },
      {},
    );
    const [blugoriId, sphinxId, crocodileId, stageId, namuleId, untouchedId] = engine.getState()
      .players.south.deck as [string, string, string, string, string, string];

    engine.playCard(op16WeLlChangeThisMissionFromSneakyToFlashy059, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const look = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    expect(look?.kind).toBe("selectEntity");
    if (look?.kind !== "selectEntity") throw new Error("Expected the look-at-5.");
    expect(
      look.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([blugoriId, sphinxId]);
    expect(
      look.candidates.filter((candidate) => !candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([crocodileId, stageId, namuleId]);
    engine.resolveDecision(
      "effectSearchSelection",
      { selectedIds: [blugoriId, sphinxId] },
      "south",
    );

    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [crocodileId, stageId, namuleId] },
      "south",
    );

    const state = engine.getState();
    // Both are PLAYED, not added to hand: revealDestination is the character area.
    expect(state.players.south.characterArea.filter(Boolean)).toEqual(
      expect.arrayContaining([blugoriId, sphinxId]),
    );
    expect(state.players.south.hand).toHaveLength(0);
    expect(state.players.south.deck).toEqual([untouchedId, crocodileId, stageId, namuleId]);
    expect(state.players.south.activeDon).toBe(0);
    expect(state.players.south.restedDon).toBe(8);
  });

  test("[Counter] +3000 holds a 7000-power attack off the Leader", () => {
    // Ace's 5000 Leader plus 3000 is 8000 against a 7000 attacker; the mutation to +2000 leaves it
    // at exactly 7000, which connects.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16WeLlChangeThisMissionFromSneakyToFlashy059, eb01Doma005],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const eventId = engine.findCardInZone(
      "north",
      "hand",
      op16WeLlChangeThisMissionFromSneakyToFlashy059,
    );
    const lifeBefore = engine.getView("north").players.north.lifeCount;

    engine.declareAttack(
      engine.findCardInZone("south", "character", op02Kingdew006),
      engine.leader("north"),
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    expect(engine.getView("north").players.north.lifeCount).toBe(lifeBefore);
  });
});
