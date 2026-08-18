import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Atmos003,
  op02Kingdew006,
  op02LittleoarsJr020,
  op03Namule007,
  op15Nola069,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A minimal opponent removal source (the op07-042-gecko-moria technique). `returnToHand` by an
// effect routes through promptForEffectRemovalReplacement (effects/actions.ts), which is the
// path `replacedEvent: "removeFromField"` sits on.
const bouncer: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-069-BOUNCER",
  canonicalId: "TEST-OP15-069-BOUNCER",
  name: "Test Nola Bouncer",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: { player: "opponent", zones: ["character"], count: { amount: 1 } },
          },
        ],
      },
    ],
  },
};

// The same effect aimed the other way, so south can bounce its OWN Character. The printed text
// protects only against 对方的效果, and nothing else in this file distinguishes "an effect" from
// "the opponent's effect".
const selfBouncer: CharacterCard = {
  ...eb01Doma005,
  id: "TEST-OP15-069-SELF-BOUNCER",
  canonicalId: "TEST-OP15-069-SELF-BOUNCER",
  name: "Test Nola Self Bouncer",
  cost: 0,
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
              filters: [{ filter: "excludeSelf" }],
            },
          },
        ],
      },
    ],
  },
};

registerCards([bouncer, selfBouncer]);

function nolaBoard(ally: typeof op03Namule007, southActiveDon = 2) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      character: [op15Nola069, ally],
      activeDon: southActiveDon,
      donDeckCount: 10 - southActiveDon,
    },
    { leaderCardId: op16PortgasDAce001, hand: [bouncer] },
    { firstPlayer: "south", activeSeat: "north" },
  );
}

describe("OP15-069 Nola", () => {
  test("ruling #907: Nola may spend a DON!! to save HERSELF", () => {
    // 可以. The obvious model, OP12-070 Sanji, is `eventFilter: { targetSelf: true }` -- self
    // only. This card is the opposite shape, and an `excludeSelf` added by analogy with the
    // "other than this Character" wording would break the ruling outright.
    const engine = nolaBoard(op03Namule007);
    const nolaId = engine.findCardInZone("south", "character", op15Nola069);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [nolaId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    // The `returnDon` ACTION prompts whenever there are more DON!! on the field than it takes --
    // `options.length > amount` on its own. That is a looser gate than the `returnDon` COST,
    // which additionally requires two DON!! KINDS before it asks, so an all-active fixture that
    // auto-pays a cost still publishes a choice here.
    engine.resolveDecision("effectReturnDon", { selectedIds: ["active-don:0"] }, "south");

    const state = engine.getState();
    expect(state.players.south.characterArea).toContain(nolaId);
    expect(state.players.south.hand).not.toContain(nolaId);
    // 1 DON!! left the field for the DON!! deck. Asserting only activeDon would not tell a
    // `returnDon` replacement from a `restDon` one.
    expect(state.players.south).toMatchObject({ activeDon: 1, restedDon: 0, donDeckCount: 9 });
  });

  test("protects an ally at exactly 7000 base power", () => {
    // On the printed line. `value 7000 -> 6000` is a mutant the tool generates and only a body
    // sitting exactly on the boundary kills it.
    const engine = nolaBoard(op02Kingdew006);
    const allyId = engine.findCardInZone("south", "character", op02Kingdew006);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision("effectReturnDon", { selectedIds: ["active-don:0"] }, "south");

    expect(engine.getState().players.south.characterArea).toContain(allyId);
    expect(engine.getState().players.south).toMatchObject({ activeDon: 1, donDeckCount: 9 });
  });

  test("protects an ally well under the line, at 5000 base power", () => {
    // "7000 or LESS": separates `lte 7000` from `gte 7000`, which agree at the boundary.
    const engine = nolaBoard(op03Namule007);
    const allyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "yes" }, "south");
    engine.resolveDecision("effectReturnDon", { selectedIds: ["active-don:0"] }, "south");

    expect(engine.getState().players.south.characterArea).toContain(allyId);
  });

  test("does NOT protect a 9000-base-power ally", () => {
    const engine = nolaBoard(op02LittleoarsJr020);
    const allyId = engine.findCardInZone("south", "character", op02LittleoarsJr020);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "north");

    // No replacement offered at all: the bounce simply happens.
    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectRemovalReplacement",
        ),
    ).toBe(false);
    expect(engine.getState().players.south.characterArea).not.toContain(allyId);
    expect(engine.getState().players.south.hand).toContain(allyId);
    expect(engine.getState().players.south).toMatchObject({ activeDon: 2, donDeckCount: 8 });
  });

  test('declining the "you may" lets the removal through and keeps the DON!!', () => {
    const engine = nolaBoard(op03Namule007);
    const allyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "north");
    engine.resolveDecision("effectRemovalReplacement", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.players.south.characterArea).not.toContain(allyId);
    expect(state.players.south).toMatchObject({ activeDon: 2, donDeckCount: 8 });
  });

  test("with no DON!! on the field the replacement is not offered", () => {
    // replacementActionIsAvailable rejects a `returnDon` of 1 against an empty field, so the
    // effect never reaches the player. No `donFieldCount` condition is needed on the encoding
    // for this, and adding one would be an unkillable mutant.
    const engine = nolaBoard(op03Namule007, 0);
    const allyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(bouncer, "north");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "north");

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectRemovalReplacement",
        ),
    ).toBe(false);
    expect(engine.getState().players.south.characterArea).not.toContain(allyId);
  });

  test("YOUR OWN effect removing your Character is NOT replaced", () => {
    // 因对方的效果 -- the opponent's effect specifically. `source: "opponentEffect"` is what
    // carries that; without it the replacement would also intercept your own bounces and,
    // worse, tax them a DON!! you did not agree to spend.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op15Nola069, op03Namule007],
        hand: [selfBouncer],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001 },
    );
    const allyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.playCard(selfBouncer, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [allyId] }, "south");

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            prompt.resolutionContext?.intent === "effectRemovalReplacement",
        ),
    ).toBe(false);
    expect(engine.getState().players.south.hand).toContain(allyId);
    expect(engine.getState().players.south).toMatchObject({ activeDon: 2, donDeckCount: 8 });
  });

  test("a battle K.O. is NOT replaced", () => {
    // The printed text is "by your opponent's EFFECT" (因对方的效果), which is why the encoding
    // uses `removeFromField` + `source: "opponentEffect"`. `leaveField` -- the value that also
    // covers a battle cause (findKoReplacement) -- would wrongly fire here.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        character: [op15Nola069, { card: op03Namule007, rested: true }],
        activeDon: 2,
        donDeckCount: 8,
      },
      { leaderCardId: op16PortgasDAce001, character: [{ card: op02Atmos003, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const allyId = engine.findCardInZone("south", "character", op03Namule007);

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Atmos003),
      allyId,
      "north",
    );

    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" &&
            (prompt.resolutionContext?.intent === "effectRemovalReplacement" ||
              prompt.resolutionContext?.intent === "battleKoReplacement"),
        ),
    ).toBe(false);
    expect(engine.getState().players.south.trash).toContain(allyId);
  });
});
