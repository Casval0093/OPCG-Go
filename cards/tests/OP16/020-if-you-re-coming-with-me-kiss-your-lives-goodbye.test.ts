import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard, LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op02LittleoarsJr020,
  op02Thatch007,
  op03Namule007,
  op16IfYouReComingWithMeKissYourLivesGoodbye020,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Two synthetics, each doing one job the real card pool cannot:
//  * thatchTwin -- a SECOND exactly-8000 Whitebeard body. A cost with exactly one eligible
//    candidate auto-pays and publishes no prompt at all (cards/ENCODING.md), so without a second
//    one the excluded cards would be unobservable and this test would pass with no filter present.
//  * powerfulLeader -- a Leader card sitting in hand at 8000 power, which never happens in real
//    play but is the only thing that can exercise `cardCategory: "character"`: basePower()
//    (effects/shared.ts) reads `.power` only for leaders and characters and hard-zeroes events and
//    stages, so no Event or Stage could ever satisfy `power eq 8000` regardless of filters. Same
//    technique as cards/tests/OP16/002-izo.test.ts.
const thatchTwin: CharacterCard = {
  ...op02Thatch007,
  id: "TEST-OP16-020-THATCH-TWIN",
  canonicalId: "TEST-OP16-020-THATCH-TWIN",
  name: "Thatch Twin",
  i18n: { en: { ...op02Thatch007.i18n.en, name: "Thatch Twin" } },
};

const powerfulLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-020-8000-LEADER",
  canonicalId: "TEST-OP16-020-8000-LEADER",
  name: "Eight Thousand Leader",
  power: 8000,
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Eight Thousand Leader" } },
};

registerCards([thatchTwin, powerfulLeader]);

describe("OP16-020 If You're Coming with Me... Kiss Your Lives Goodbye!!", () => {
  test("ruling #975: the [Main] reveal needs a Character card at EXACTLY 8000 power", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16PortgasDAce001,
        hand: [
          op16IfYouReComingWithMeKissYourLivesGoodbye020,
          op02Thatch007,
          thatchTwin,
          op02Kingdew006,
          op02LittleoarsJr020,
          powerfulLeader,
        ],
        deck: [op03Namule007, eb01Doma005, eb01Doma005, eb01Doma005, eb01Doma005],
        activeDon: 1,
      },
      {},
    );
    const thatchId = engine.findCardInZone("south", "hand", op02Thatch007);
    const twinId = engine.findCardInZone("south", "hand", thatchTwin);
    const drawnId = engine.getState().players.south.deck[0]!;

    engine.playCard(op16IfYouReComingWithMeKissYourLivesGoodbye020, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const reveal = engine.pendingDecision("effectCostRevealFromHand", "south").steps[0];
    // A cost selection projects as kind "payCost", not "selectEntity" (projection.ts).
    expect(reveal?.kind).toBe("payCost");
    if (reveal?.kind !== "payCost") throw new Error("Expected the 8000-power reveal cost.");
    // 7000 out, 9000 out, and the 8000-power Leader out.
    expect(reveal.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [thatchId, twinId].sort(),
    );
    engine.resolveDecision("effectCostRevealFromHand", { selectedIds: [thatchId] }, "south");

    const state = engine.getState();
    expect(state.players.south.hand).toContain(drawnId);
    // The revealed card is a cost, not a discard: it stays in hand.
    expect(state.players.south.hand).toContain(thatchId);
    // "rest 1 of your DON!! cards" really is paid.
    expect(state.players.south.activeDon).toBe(0);
    expect(state.players.south.restedDon).toBe(1);
  });

  test("[Counter] +3000 saves a 5000-power Character from a 7000-power attacker", () => {
    // The magnitude has to decide something, because a `thisBattle` modifier is created and
    // expired inside the same call that resolves the last prompt (cards/ENCODING.md). 5000 + 3000
    // = 8000 beats the 7000 attacker; the mutation to +2000 gives 7000, and `attackPower >=
    // defensePower` is a hit, so Namule would die.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16PortgasDAce001,
        hand: [op16IfYouReComingWithMeKissYourLivesGoodbye020, eb01Doma005],
        character: [{ card: op03Namule007, rested: true }],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const eventId = engine.findCardInZone(
      "north",
      "hand",
      op16IfYouReComingWithMeKissYourLivesGoodbye020,
    );
    const fodderId = engine.findCardInZone("north", "hand", eb01Doma005);

    engine.declareAttack(attackerId, namuleId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "north");
    // No `effectCostTrashFromHand` step to resolve: playing the event as a [Counter] leaves
    // exactly one card in hand, and a cost with a single eligible candidate auto-pays with no
    // prompt at all (cards/ENCODING.md). `fodderId` below is that auto-paid card.

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (boost?.kind !== "selectEntity") throw new Error("Expected the +3000 recipient choice.");
    // "your Leader or Character cards" -- both zones.
    expect(boost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), namuleId].sort(),
    );
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.characters.some((card) => card?.instanceId === namuleId)).toBe(true);
    expect(view.players.north.trash.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining([eventId, fodderId]),
    );
  });
});
