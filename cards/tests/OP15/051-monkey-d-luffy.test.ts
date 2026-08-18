import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op04Rebecca039, op15MonkeyDLuffy051 } from "@tcg/op-cards";

import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op04Rebecca039 is [Dressrosa] and inert here (its only abilities are a permanent `cannotAttack`
// on itself and a DON!!-resting [Activate: Main]); op02Smoker093 is [Navy] and equally inert.
function luffyUnder(leaderCardId: CardRef, activeSeat: "south" | "north") {
  const engine = OnePieceTestEngine.create(
    { leaderCardId, character: [op15MonkeyDLuffy051] },
    { leaderCardId: op02Smoker093 },
    { firstPlayer: activeSeat === "south" ? "north" : "south", activeSeat },
  );
  const luffyId = engine.findCardInZone("south", "character", op15MonkeyDLuffy051);
  const card = engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === luffyId);
  if (!card || card.power === null) throw new Error("Luffy was not projected with a power.");
  return card.power;
}

describe("OP15-051 Monkey.D.Luffy", () => {
  test("[Opponent's Turn] under a [Dressrosa] Leader: exactly +3000", () => {
    // 4000 printed base -> 7000. Both gates hold here; each of the two tests below removes one.
    expect(luffyUnder(op04Rebecca039, "north")).toBe(7000);
  });

  test("on YOUR turn there is no bonus, even under a [Dressrosa] Leader", () => {
    expect(luffyUnder(op04Rebecca039, "south")).toBe(4000);
  });

  test("on the opponent's turn under a non-[Dressrosa] Leader there is no bonus", () => {
    expect(luffyUnder(op02Smoker093, "north")).toBe(4000);
  });
});
