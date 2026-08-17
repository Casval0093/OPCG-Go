import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op03Camie101,
  op03Fossa010,
  op03Namule007,
  op05Enel098,
  op12Seto103,
  op15Wyper114,
} from "@tcg/op-cards";

import { OnePieceTestEngine, getLegalCommands, type PlayerFixture } from "../../../src/index.ts";

// The -2000 magnitude is a NEGATIVE number, so `mutation_check.py` generates no mutant for it at
// all -- the boundary has to be written by hand. These two opponent bodies straddle it exactly:
//   op03Fossa010   2000 power -> 0     -> K.O.'d by the "0 power or less" half
//   op03Camie101   3000 power -> 1000  -> survives
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function wyperOnPlay(life: PlayerFixture["life"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15Wyper114], life, activeDon: 5 },
    {
      character: [
        { card: op03Fossa010, playedOnTurn: 0 },
        { card: op03Camie101, playedOnTurn: 0 },
      ],
    },
    SOUTH_ACTS,
  );
}

describe("OP15-114 Wyper", () => {
  test("[On Play] gives EVERY opponent Character -2000 and K.O.s the ones that reach 0", () => {
    const engine = wyperOnPlay(3);
    const fossaId = engine.findCardInZone("north", "character", op03Fossa010);
    const camieId = engine.findCardInZone("north", "character", op03Camie101);

    engine.playCard(op15Wyper114, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const state = engine.getState();
    expect(state.cards[fossaId]?.zone).toBe("trash");
    // The survivor is the assertion that pins the magnitude AND `count: { amount: "all" }`: at
    // -1000 Camie would sit at 2000 and Fossa at 1000 (no K.O. at all); at -3000 Camie would
    // reach 0 and die too; and targeting only one Character would leave Camie untouched at 3000.
    expect(state.cards[camieId]?.zone).toBe("character");
    expect(
      engine.getView("south").players.north.characters.find((card) => card?.instanceId === camieId)
        ?.power,
    ).toBe(1000);
    // The cost really flipped the top Life card face-up.
    expect(state.cards[state.players.south.life[0] ?? ""]?.faceUp).toBe(true);
  });

  test("ruling #942: the effect cannot be used when the top Life card is already face-up", () => {
    // 不可以 -- and it needs no condition: `canPayCosts` rejects a `turnLifeFaceUp` whose target
    // card is already in the requested state, so the optional confirm is never published.
    const engine = wyperOnPlay([{ card: op01Sai012, faceUp: true }, op01Sai012, op01Sai012]);
    const fossaId = engine.findCardInZone("north", "character", op03Fossa010);

    engine.playCard(op15Wyper114, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[fossaId]?.zone).toBe("character");
  });

  test("ruling #942: nor at 0 Life cards", () => {
    const engine = wyperOnPlay(0);
    const fossaId = engine.findCardInZone("north", "character", op03Fossa010);

    engine.playCard(op15Wyper114, "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getState().cards[fossaId]?.zone).toBe("character");
  });

  test("declining leaves the whole board alone", () => {
    const engine = wyperOnPlay(3);
    const fossaId = engine.findCardInZone("north", "character", op03Fossa010);

    engine.playCard(op15Wyper114, "south");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    expect(engine.getState().cards[fossaId]?.zone).toBe("character");
    expect(engine.getState().cards[engine.getState().players.south.life[0] ?? ""]?.faceUp).toBe(
      false,
    );
  });

  test("[Activate: Main] hands a rested DON!! only to [Sky Island] Leader or Character cards", () => {
    const engine = OnePieceTestEngine.create(
      {
        // op05Enel098 is a [Sky Island] Leader, so the Leader is a legal recipient here; Namule
        // (Fish-Man/Whitebeard Pirates) is the exclusion.
        leaderCardId: op05Enel098,
        character: [
          { card: op15Wyper114, playedOnTurn: 0 },
          { card: op12Seto103, playedOnTurn: 0 },
          { card: op03Namule007, playedOnTurn: 0 },
        ],
        restedDon: 3,
      },
      {},
      SOUTH_ACTS,
    );
    const wyperId = engine.findCardInZone("south", "character", op15Wyper114);
    const setoId = engine.findCardInZone("south", "character", op12Seto103);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    engine.activateEffect(wyperId, "activateMain", "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (selection?.kind !== "selectEntity") throw new Error("Expected a target selection.");
    const candidateIds = selection.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds.sort()).toEqual([engine.leader("south"), wyperId, setoId].sort());
    expect(candidateIds).not.toContain(namuleId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [setoId] }, "south");
    expect(engine.getState().cards[setoId]?.attachedDon).toBe(1);
    expect(engine.getState().players.south.restedDon).toBe(2);
  });

  test("[Once Per Turn]: a second activation is not offered", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op05Enel098,
        character: [{ card: op15Wyper114, playedOnTurn: 0 }],
        restedDon: 3,
      },
      {},
      SOUTH_ACTS,
    );
    const wyperId = engine.findCardInZone("south", "character", op15Wyper114);

    engine.activateEffect(wyperId, "activateMain", "south");
    engine.resolveDecision("effectGiveDonCount", { optionId: "1" }, "south");
    engine.resolveDecision(
      "effectTargetSelection",
      { selectedIds: [engine.leader("south")] },
      "south",
    );

    // Delete `oncePerTurn` and this goes red: without it nothing else limits the ability.
    expect(
      getLegalCommands(engine.getState(), "south").filter(
        (command) => command.type === "activateEffect" && command.sourceId === wyperId,
      ),
    ).toHaveLength(0);
  });
});
