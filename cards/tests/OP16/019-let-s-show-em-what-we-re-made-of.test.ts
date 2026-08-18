import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02LittleoarsJr020,
  op02Thatch007,
  op03Namule007,
  op11Saldeath064,
  op16LetSShowEmWhatWeReMadeOf019,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Every fixture is a genuinely vanilla pre-OP15 Character, chosen so the boundary is pinned from
// both sides and the trait is pinned independently of the power:
//   op02Thatch007         Whitebeard Pirates, 8000  -- eligible
//   thatchTwin (below)    Whitebeard Pirates, 8000  -- eligible; the second one, so "up to 2"
//                                                      really plays two bodies
//   op02Kingdew006        Whitebeard Pirates, 7000  -- kills `value 8000 -> 7000`
//   op02LittleoarsJr020   Whitebeard Pirates, 9000  -- kills `comparison eq -> gte`
//   op11Saldeath064       Impel Down,         8000  -- kills deleting the trait filter
const thatchTwin: CharacterCard = {
  ...op02Thatch007,
  id: "TEST-OP16-019-THATCH-TWIN",
  canonicalId: "TEST-OP16-019-THATCH-TWIN",
  name: "Thatch Twin",
  i18n: { en: { ...op02Thatch007.i18n.en, name: "Thatch Twin" } },
};

registerCards([thatchTwin]);

describe("OP16-019 Let's Show 'Em What We're Made Of!!", () => {
  test("ruling #974: only Whitebeard Pirates Characters at EXACTLY 8000 power may be played", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [
          op16LetSShowEmWhatWeReMadeOf019,
          op02Thatch007,
          thatchTwin,
          op02Kingdew006,
          op02LittleoarsJr020,
          op11Saldeath064,
        ],
        activeDon: 9,
      },
      {},
    );
    const thatchId = engine.findCardInZone("south", "hand", op02Thatch007);
    const twinId = engine.findCardInZone("south", "hand", thatchTwin);

    engine.playCard(op16LetSShowEmWhatWeReMadeOf019, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected the play-up-to-2 offer.");
    // The exact set: 7000 out, 9000 out, non-Whitebeard-8000 out.
    expect(play.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [thatchId, twinId].sort(),
    );
    engine.resolveDecision("effectPlaySelection", { selectedIds: [thatchId, twinId] }, "south");

    const characters = engine.getView("south").players.south.characters;
    expect(characters.filter((card) => card !== null)).toHaveLength(2);
    expect(characters.some((card) => card?.instanceId === thatchId)).toBe(true);
    expect(characters.some((card) => card?.instanceId === twinId)).toBe(true);
  });

  test("[Trigger] gives the Leader +1000 for the turn, enough to survive a 5000 attacker", () => {
    // The magnitude, not just the recipient, is what this asserts -- and it cannot be read off a
    // projection, because a `thisTurn` power modifier on a Leader is applied and consumed inside
    // the same call. So make it decide a battle: Ace's Leader is 5000 base, +1000 = 6000, and the
    // second attacker is pitched at exactly 5000. `attackPower >= defensePower` is a hit, so the
    // real +1000 holds the attack off while `value: 0` (the mutation of 1000) would let it through.
    const engine = OnePieceTestEngine.create(
      {
        character: [
          { card: op02Kingdew006, playedOnTurn: 0 },
          { card: op03Namule007, playedOnTurn: 0 },
        ],
      },
      {
        leaderCardId: op16PortgasDAce001,
        // life[0] is the card damage takes (battle.ts), so the event is the first one removed.
        life: [op16LetSShowEmWhatWeReMadeOf019, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bigAttackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const smallAttackerId = engine.findCardInZone("south", "character", op03Namule007);

    // 7000 beats the unboosted 5000 Leader: Life drops to 4 and the event's [Trigger] activates.
    // No `battleCounter` step to resolve here: that prompt is only published when the defender
    // actually holds a Counter-playable card, and north's hand is empty.
    engine.declareAttack(bigAttackerId, engine.leader("north"), "south");
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");
    expect(engine.getView("north").players.north.lifeCount).toBe(4);

    // 5000 vs the now-6000 Leader: no damage.
    engine.declareAttack(smallAttackerId, engine.leader("north"), "south");
    expect(engine.getView("north").players.north.lifeCount).toBe(4);
  });
});
