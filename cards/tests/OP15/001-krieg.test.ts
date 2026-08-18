import { describe, expect, test } from "vite-plus/test";
import { op02Atmos003, op03Genzo046, op03Merry052, op15Krieg001 } from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Fixture cards are all genuinely vanilla engine cards (OP02/OP03), chosen so nothing but Krieg's
// own permanent effect can move a power number:
//   op03Genzo046   East Blue, 4000        -- satisfies "only East Blue Characters"
//   op03Merry052   East Blue, 3000        -- second East Blue body / debuff observation target
//   op02Atmos003   Whitebeard Pirates, 6000 -- the non-East-Blue body that must break the condition
//
// `match: "includes"` on the trait filter is substring matching per candidate trait string
// (matchesTargetFilter, effects/targeting.ts), which is why it works against both the modern
// one-trait-per-entry shape and the older concatenated-trait cards.

function kriegVsOpponent(
  northCharacters: PlayerFixture["character"],
  southCharacters: PlayerFixture["character"],
  { attachDon = true, passTurn = true }: { attachDon?: boolean; passTurn?: boolean } = {},
) {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: op15Krieg001, activeDon: 1, character: southCharacters },
    { character: northCharacters },
    { firstPlayer: "south", activeSeat: "south" },
  );
  if (attachDon) {
    // Attached DON!! returns only during its own controller's Refresh Phase
    // (resetStartOfTurnState, state.ts), so DON!! given here is still on the Leader for the whole
    // of north's turn -- which is the only window [Opponent's Turn] applies in.
    engine.attachDon(engine.leader("south"), 1, "south");
  }
  if (passTurn) {
    engine.endTurn("south");
  }
  return engine;
}

function northPower(engine: OnePieceTestEngine, instanceId: string) {
  return engine
    .getView("north")
    .players.north.characters.find((card) => card?.instanceId === instanceId)?.power;
}

describe("OP15-001 Krieg", () => {
  test("ruling #852: with ZERO Characters of your own, the -2000 does NOT apply", () => {
    // This is the test the encoding exists for. "If the only Characters on your field are [East
    // Blue] type Characters" is vacuously TRUE of an empty character area in English, and the
    // shape EB02-010 Monkey.D.Luffy uses for this same printed phrasing -- a lone
    // `zoneCount ... eq 0` over non-matching traits -- therefore fires on an empty field. Ruling
    // #852 says it must not (不会). Delete the `gte 1` condition from the encoding and this goes
    // red at 4000 vs 2000; every other test in this file stays green.
    const engine = kriegVsOpponent([op03Genzo046], []);
    const targetId = engine.findCardInZone("north", "character", op03Genzo046);

    expect(northPower(engine, targetId)).toBe(4000);
  });

  test("applies -2000 to every opponent Character while your only Characters are East Blue", () => {
    const engine = kriegVsOpponent([op03Genzo046, op02Atmos003], [op03Merry052]);
    const genzoId = engine.findCardInZone("north", "character", op03Genzo046);
    const atmosId = engine.findCardInZone("north", "character", op02Atmos003);

    // "all of your opponent's Characters" -- both, regardless of their own traits.
    expect(northPower(engine, genzoId)).toBe(2000);
    expect(northPower(engine, atmosId)).toBe(4000);
  });

  test("a single non-East-Blue Character of your own switches the effect off", () => {
    const engine = kriegVsOpponent([op03Merry052], [op03Genzo046, op02Atmos003]);
    const targetId = engine.findCardInZone("north", "character", op03Merry052);

    expect(northPower(engine, targetId)).toBe(3000);
  });

  test("does not apply during your own turn", () => {
    const engine = kriegVsOpponent([op03Genzo046], [op03Merry052], { passTurn: false });
    const targetId = engine.findCardInZone("north", "character", op03Genzo046);

    expect(northPower(engine, targetId)).toBe(4000);
  });

  test("does not apply without [DON!! x1] given to the Leader", () => {
    const engine = kriegVsOpponent([op03Genzo046], [op03Merry052], { attachDon: false });
    const targetId = engine.findCardInZone("north", "character", op03Genzo046);

    expect(northPower(engine, targetId)).toBe(4000);
  });
});
