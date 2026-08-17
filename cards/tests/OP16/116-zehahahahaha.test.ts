import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  eb01Doma005,
  op02Kingdew006,
  op03Namule007,
  op09AvaloPizarro082,
  op16MarshallDTeach080,
  op16Zehahahahaha116,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// A synthetic Character named "Marshall.D.Teach" rather than one of the six real printings: every
// pre-OP15 Teach Character carries its own effects, and this action PLAYS the card, so a real one
// would fire an [On Play] into the middle of the prompt sequence under test. `differentNames` and
// the `name` filter read two different fields (`card.name` in resolution.ts vs `i18n.en.name` via
// cardName() in shared.ts), so override both -- forgetting the i18n half makes the filter silently
// match nothing (cards/ENCODING.md).
const teachCharacter: CharacterCard = {
  ...op09AvaloPizarro082,
  id: "TEST-OP16-116-TEACH",
  canonicalId: "TEST-OP16-116-TEACH",
  name: "Marshall.D.Teach",
  i18n: { en: { ...op09AvaloPizarro082.i18n.en, name: "Marshall.D.Teach" } },
};

registerCards([teachCharacter]);

// 10 active DON!! minus the event's own cost of 8 leaves 2 active and 8 rested -- still 10 DON!!
// cards on the field, because donCardsOnField (shared.ts) counts active, rested and attached
// alike. So `activeDon` here is the field total, not the amount left after paying.
function playZehahahahaha(activeDon: number, opponentLife: number) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16MarshallDTeach080,
      hand: [op16Zehahahahaha116, teachCharacter, op03Namule007],
      activeDon,
    },
    { life: Array.from({ length: opponentLife }, () => eb01Doma005) },
  );
  engine.playCard(op16Zehahahahaha116, "south");
  return engine;
}

describe("OP16-116 Zehahahahaha!", () => {
  test("with 10 DON!! on the field, plays Marshall.D.Teach and takes the top of opponent Life", () => {
    const engine = playZehahahahaha(10, 3);
    const teachId = engine.findCardInZone("south", "hand", teachCharacter);
    const namuleId = engine.findCardInZone("south", "hand", op03Namule007);
    const topLifeId = engine.getState().players.north.life[0]!;

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected the Marshall.D.Teach play offer.");
    // Namule is in hand, is a Character, and is not offered: the name filter is the only thing
    // separating them. Asserting the exact list is what makes deleting that filter go red.
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([teachId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [teachId] }, "south");

    // An `upTo` Life removal asks for a count first -- intent `effectRemoveFromLifeCount`, a
    // chooseOption step whose option ids are the numbers "0".."max".
    const count = engine.pendingDecision("effectRemoveFromLifeCount", "south").steps[0];
    expect(count?.kind).toBe("chooseOption");
    engine.resolveDecision("effectRemoveFromLifeCount", { optionId: "1" }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === teachId)).toBe(true);
    expect(view.players.north.lifeCount).toBe(2);
    // "to the owner's hand" -- the opponent's own hand, not the caster's.
    expect(engine.getState().players.north.hand).toContain(topLifeId);
    expect(engine.getState().players.south.hand).not.toContain(topLifeId);
  });

  test("with 9 DON!! on the field nothing happens at all", () => {
    const engine = playZehahahahaha(9, 3);
    const eventId = engine.findCardInZone("south", "trash", op16Zehahahahaha116);

    // The condition gates the whole block, so there is no play offer and no Life removal -- and
    // the event is still played and trashed, which is what distinguishes a failed condition from
    // a failed activation.
    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north.lifeCount).toBe(3);
    expect(view.players.south.trash.map((card) => card.instanceId)).toContain(eventId);
  });

  test("with 11 DON!! on the field nothing happens either -- the count is exactly 10", () => {
    // Eleven DON!! cannot arise in real play (the DON!! deck holds ten), but a fixture can set it,
    // and it is the only way to tell `eq 10` from `gte 10`: under `gte` this fires.
    const engine = playZehahahahaha(11, 3);

    expect(engine.getView("south").prompts).toHaveLength(0);
    expect(engine.getView("south").players.north.lifeCount).toBe(3);
  });

  test("ruling #1015: at 0 opponent Life the Teach play still happens", () => {
    const engine = playZehahahahaha(10, 0);
    const teachId = engine.findCardInZone("south", "hand", teachCharacter);

    engine.resolveDecision("effectPlaySelection", { selectedIds: [teachId] }, "south");

    expect(
      engine.getView("south").players.south.characters.some((card) => card?.instanceId === teachId),
    ).toBe(true);
  });

  test("[Trigger] draws 2 cards, then trashes 1 from hand", () => {
    const engine = OnePieceTestEngine.create(
      // 7000 clears Teach's 5000-power Leader, so the attack connects and removes a Life card.
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      {
        leaderCardId: op16MarshallDTeach080,
        hand: [op03Namule007],
        life: [op16Zehahahahaha116],
        deck: [op09AvaloPizarro082, op02Kingdew006, eb01Doma005, eb01Doma005],
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op02Kingdew006);
    const existingId = engine.findCardInZone("north", "hand", op03Namule007);
    const firstDrawId = engine.findCardInZone("north", "deck", op09AvaloPizarro082);
    const secondDrawId = engine.findCardInZone("north", "deck", op02Kingdew006);

    engine.declareAttack(attackerId, engine.leader("north"), "south");
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");
    // `lifeTrigger` takes `activate`, not `yes` (cards/ENCODING.md).
    engine.resolveDecision("lifeTrigger", { optionId: "activate" }, "north");

    const trash = engine.pendingDecision("effectTrashFromHandSelection", "north").steps[0];
    expect(trash?.kind).toBe("selectEntity");
    if (trash?.kind !== "selectEntity") throw new Error("Expected the mandatory post-draw trash.");
    expect(trash.candidates.map((candidate) => candidate.ref.id)).toEqual([
      existingId,
      firstDrawId,
      secondDrawId,
    ]);
    engine.resolveDecision("effectTrashFromHandSelection", { selectedIds: [firstDrawId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.hand.map((card) => card.instanceId)).toEqual([
      existingId,
      secondDrawId,
    ]);
    expect(view.prompts).toHaveLength(0);
  });
});
