import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02LittleoarsJr020,
  op09MarshallDTeach081,
  op16SanjuanWolf106,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const SOUTH_ATTACKS = { firstPlayer: "north", activeSeat: "south" } as const;

// Only the draw and the Leader-type gate are encoded here -- see the PARKED note on the card for
// the "base power becomes 7000" clause. op02LittleoarsJr020 is 9000 power, comfortably over
// Sanjuan.Wolf's 5000, so the battle K.O. is unconditional.
describe("OP16-106 Sanjuan.Wolf", () => {
  test("[On K.O.] draws 1 under a [Blackbeard Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        character: [{ card: op16SanjuanWolf106, rested: true }],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const sanjuanId = engine.findCardInZone("north", "character", op16SanjuanWolf106);

    expect(engine.getView("north").players.north.hand).toHaveLength(0);

    engine.declareAttack(attackerId, sanjuanId, "south");

    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(1);
  });

  test("[On K.O.] draws nothing without a [Blackbeard Pirates] Leader", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      { character: [{ card: op16SanjuanWolf106, rested: true }] },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const sanjuanId = engine.findCardInZone("north", "character", op16SanjuanWolf106);

    engine.declareAttack(attackerId, sanjuanId, "south");

    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
    expect(engine.getView("north").players.north.hand).toHaveLength(0);
  });

  test("[Trigger] activates this card's own [On K.O.] from the Life area", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02LittleoarsJr020, playedOnTurn: 0 }] },
      {
        leaderCardId: op09MarshallDTeach081,
        life: [op16SanjuanWolf106, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      },
      SOUTH_ATTACKS,
    );
    const attackerId = engine.findCardInZone("south", "character", op02LittleoarsJr020);
    const sanjuanId = engine.findCardInZone("north", "life", op16SanjuanWolf106);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    expect(engine.getView("north").players.north.hand).toHaveLength(1);
    expect(engine.getState().cards[sanjuanId]?.zone).toBe("trash");
  });
});
