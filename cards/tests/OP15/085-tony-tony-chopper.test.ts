import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  eb02MerryGo041,
  op01MonkeyDLuffy003,
  op02Atmos003,
  op02Usopp028,
  op06GeckoMoria080,
  op11TonyTonyChopper053,
  op15TonyTonyChopper085,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// Every card in this trash breaks exactly one filter and is right about the rest:
//   op02Usopp028              cost 3, Character, [Film Straw Hat Crew]  -- the only legal pick
//   op02Atmos003              Character, [Whitebeard Pirates]           -- kills delete filter:trait
//   eb02MerryGo041            STAGE, [Straw Hat Crew]                   -- kills delete filter:cardCategory
//   op11TonyTonyChopper053    Character, [Animal Straw Hat Crew], named "Tony Tony.Chopper"
//                                                                      -- kills delete filter:excludeName
const TRASH = [op02Usopp028, op02Atmos003, eb02MerryGo041, op11TonyTonyChopper053];

function chopperOnField(leaderCardId: LeaderCard) {
  return OnePieceTestEngine.create(
    {
      leaderCardId,
      character: [{ card: op15TonyTonyChopper085, playedOnTurn: 0 }],
      trash: TRASH,
      deck: 10,
    },
    {},
  );
}

function activateChopper(engine: OnePieceTestEngine) {
  engine.exec({
    type: "activateEffect",
    seat: "south",
    sourceInstanceId: engine.findCardInZone("south", "character", op15TonyTonyChopper085),
    trigger: "activateMain",
  });
  engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
}

describe("OP15-085 Tony Tony.Chopper", () => {
  test("the [On Play] mills exactly 3", () => {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op01MonkeyDLuffy003, hand: [op15TonyTonyChopper085], deck: 20, activeDon: 3 },
      {},
    );

    engine.playCard(op15TonyTonyChopper085, "south");

    expect(engine.getState().players.south.deck).toHaveLength(17);
    expect(engine.getState().players.south.trash).toHaveLength(3);
  });

  test("under a [Straw Hat Crew] Leader only the one legal card in the trash is offered", () => {
    const engine = chopperOnField(op01MonkeyDLuffy003);
    const usoppId = engine.findCardInZone("south", "trash", op02Usopp028);
    const atmosId = engine.findCardInZone("south", "trash", op02Atmos003);
    const merryGoId = engine.findCardInZone("south", "trash", eb02MerryGo041);
    const otherChopperId = engine.findCardInZone("south", "trash", op11TonyTonyChopper053);

    activateChopper(engine);

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected Chopper's trash selection.");
    const candidateIds = step.candidates.map((candidate) => candidate.ref.id);

    expect(candidateIds).toEqual([usoppId]);
    expect(candidateIds).not.toContain(atmosId);
    expect(candidateIds).not.toContain(merryGoId);
    // "other than [Tony Tony.Chopper]" excludes a DIFFERENT printing of Chopper too, which is
    // what makes this an `excludeName` rather than an `excludeSelf`.
    expect(candidateIds).not.toContain(otherChopperId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [usoppId] }, "south");

    expect(engine.getState().cards[usoppId]?.zone).toBe("hand");
  });

  test("under the wrong Leader the cost is still paid and nothing is added", () => {
    // The Leader check sits AFTER the cost colon, so it gates the payload only: Chopper is
    // trashed and buys nothing. Move the check to `block.conditions` and the activation would be
    // refused outright instead, leaving Chopper on the field -- which is what this asserts.
    const engine = chopperOnField(op06GeckoMoria080);
    const chopperId = engine.findCardInZone("south", "character", op15TonyTonyChopper085);

    activateChopper(engine);

    const state = engine.getState();
    expect(state.cards[chopperId]?.zone).toBe("trash");
    expect(state.players.south.hand).toHaveLength(0);
    expect(
      state.promptQueue.filter(
        (prompt) =>
          prompt.status === "pending" &&
          prompt.resolutionContext?.intent === "effectTargetSelection",
      ),
    ).toHaveLength(0);
  });
});
