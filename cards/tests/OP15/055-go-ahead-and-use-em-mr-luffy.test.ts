import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op03Genzo046,
  op10BlueGilly054,
  op15GoAheadAndUseEmMrLuffy055,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

const CARD = op15GoAheadAndUseEmMrLuffy055;

function useIt(character: unknown[]) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op15Krieg001,
      hand: [CARD],
      activeDon: 3,
      deck: [op03Genzo046, op02Atmos003],
      character: character as never,
    },
    {},
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-055 Go Ahead and Use 'Em, Mr. Luffy!!!", () => {
  test("[Main] first option draws 2", () => {
    const engine = useIt([]);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "0" }, "south");

    expect(engine.getView("south").players.south.hand).toHaveLength(2);
  });

  test("[Main] second option grants [Blocker] to a [Dressrosa] Character only", () => {
    const engine = useIt([op10BlueGilly054, op02Atmos003]);
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const atmosId = engine.findCardInZone("south", "character", op02Atmos003);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "1" }, "south");

    const grant = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(grant?.kind).toBe("selectEntity");
    if (grant?.kind !== "selectEntity") throw new Error("Expected the [Blocker] grant target.");
    // Atmos is Whitebeard Pirates; drop the trait filter and it joins the candidates.
    expect(grant.candidates.map((candidate) => candidate.ref.id)).toEqual([blueGillyId]);
    expect(grant.candidates.map((candidate) => candidate.ref.id)).not.toContain(atmosId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");
  });

  test("the granted [Blocker] is real and outlasts the turn -- it can block on the opponent's turn", () => {
    // Proves the grant functionally rather than by reading a projected keyword, and pins the
    // `untilEndOfOpponentNextEndPhase` duration in the same test: a `thisTurn` duration would be gone
    // by the time north declares its attack, so Blue Gilly would not be offered as a Blocker at all.
    const engine = useIt([op10BlueGilly054]);
    const blueGillyId = engine.findCardInZone("south", "character", op10BlueGilly054);

    engine.playCard(CARD, "south");
    engine.resolveDecision("effectActionChoice", { optionId: "1" }, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");
    engine.endTurn("south");

    engine.declareAttack(engine.leader("north"), engine.leader("south"), "north");

    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected a Blocker decision.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(blueGillyId);
  });
});
