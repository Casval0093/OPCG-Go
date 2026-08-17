import { describe, expect, test } from "vite-plus/test";
import type { EventCard } from "@tcg/op-types";
import {
  eb01OffWhite019,
  op02Blugori084,
  op02Kingdew006,
  op03Namule007,
  op16Buggy041,
  op16PrisonerOfImpelDown042,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Ruling #988 needs one of YOUR OWN effects to move your own Impel Down Character off the field.
// No pre-OP15 engine card does exactly that with no strings attached, so this is the synthetic
// stand-in -- the same technique packages/engine/tests/cards/review-regressions.test.ts uses, and
// the same reason: an effect shape the reference cards do not happen to provide.
const returnOwnCharacterEvent: EventCard = {
  ...eb01OffWhite019,
  id: "TEST-OP16-041-BOUNCE",
  canonicalId: "TEST-OP16-041-BOUNCE",
  name: "Recall",
  cost: 0,
  effect: "[Main] Return up to 1 of your Characters to the owner's hand.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "returnToHand",
            target: { player: "self", zones: ["character"], count: { amount: 1, upTo: true } },
          },
        ],
      },
    ],
  },
  i18n: { en: { ...eb01OffWhite019.i18n.en, name: "Recall" } },
};

registerCards([returnOwnCharacterEvent]);

// op02Blugori084 is "Animal Impel Down", cost 1, 3000, genuinely vanilla. op03Namule007 is
// "Fish-Man Whitebeard Pirates" -- the body whose removal must NOT fire this. OP16-042 Prisoner of
// Impel Down prints only a deck-building rule ("you may have any number of this card in your
// deck"), so playing it resolves nothing of its own.

function buggyWith(fixture: PlayerFixture) {
  return OnePieceTestEngine.create({ leaderCardId: op16Buggy041, ...fixture }, {});
}

function bounce(engine: OnePieceTestEngine, targetId: string) {
  engine.playCard(returnOwnCharacterEvent, "south");
  engine.resolveDecision("effectTargetSelection", { selectedIds: [targetId] }, "south");
}

describe("OP16-041 Buggy", () => {
  test("ruling #988: your OWN effect moving an Impel Down Character off the field fires it", () => {
    // The reason this is `whenCharacterRemoved` with no `causedBy` filter. OP10-042 Usopp, the
    // closest existing model, prints "removed from the field by your opponent's effect" and does
    // carry `causedBy: "opponent"`; this card prints neither, and #988 confirms the broad reading
    // (可以. 当因我方的效果我方拥有《因佩尔地狱》特征的角色离开场上时，也可以发动此效果).
    const engine = buggyWith({
      hand: [returnOwnCharacterEvent, op16PrisonerOfImpelDown042, op03Namule007],
      character: [op02Blugori084],
      activeDon: 1,
    });
    engine.attachDon(engine.leader("south"), 1, "south");
    const prisonerId = engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042);
    const namuleHandId = engine.findCardInZone("south", "hand", op03Namule007);

    bounce(engine, engine.findCardInZone("south", "character", op02Blugori084));
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Buggy's Prisoner play offer.");
    // Namule is a Character in the same hand and is not offered -- the name filter is the only
    // thing keeping it out, and the bounced Blugori (now also in hand) likewise.
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([prisonerId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleHandId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [prisonerId] }, "south");

    expect(
      engine
        .getView("south")
        .players.south.characters.some((card) => card?.instanceId === prisonerId),
    ).toBe(true);
  });

  test("an opponent's battle K.O. of an Impel Down Character fires it too", () => {
    // "removed from the field" (离开场上) is cause-agnostic, so the canonical case has to work as
    // well as #988's. This is the case a `replacedEvent`-style `removeFromField`-only reading would
    // silently miss (cards/ENCODING.md, OP15-098): battle K.O. and effect removal are separate
    // code paths in the engine and `whenCharacterRemoved` is fired from both (battle.ts:80 and
    // effects/resolution.ts's enqueueCharacterRemovalEffects).
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16Buggy041,
        hand: [op16PrisonerOfImpelDown042],
        character: [{ card: op02Blugori084, rested: true }],
        activeDon: 1,
      },
      { character: [{ card: op02Kingdew006, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "south" },
    );
    // Attached DON!! is only returned at the start of its own controller's Refresh Phase
    // (resetStartOfTurnState, state.ts), so [DON!! x1] still holds through north's whole turn.
    engine.attachDon(engine.leader("south"), 1, "south");
    const blugoriId = engine.findCardInZone("south", "character", op02Blugori084);
    const prisonerId = engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042);
    engine.endTurn("south");

    engine.declareAttack(
      engine.findCardInZone("north", "character", op02Kingdew006),
      blugoriId,
      "north",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision("effectPlaySelection", { selectedIds: [prisonerId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.characters.some((card) => card?.instanceId === blugoriId)).toBe(
      false,
    );
    expect(view.players.south.characters.some((card) => card?.instanceId === prisonerId)).toBe(
      true,
    );
  });

  test("removing a Character without the Impel Down type does not fire it", () => {
    const engine = buggyWith({
      hand: [returnOwnCharacterEvent, op16PrisonerOfImpelDown042],
      character: [op03Namule007],
      activeDon: 1,
    });
    engine.attachDon(engine.leader("south"), 1, "south");

    bounce(engine, engine.findCardInZone("south", "character", op03Namule007));

    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[DON!! x1]: without DON!! given to the Leader it does not fire", () => {
    const engine = buggyWith({
      hand: [returnOwnCharacterEvent, op16PrisonerOfImpelDown042],
      character: [op02Blugori084],
      activeDon: 1,
    });

    bounce(engine, engine.findCardInZone("south", "character", op02Blugori084));

    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("[Once Per Turn]: a second Impel Down removal in the same turn does not fire it", () => {
    const engine = buggyWith({
      hand: [
        returnOwnCharacterEvent,
        returnOwnCharacterEvent,
        op16PrisonerOfImpelDown042,
        op16PrisonerOfImpelDown042,
      ],
      character: [op02Blugori084, op02Blugori084],
      activeDon: 1,
    });
    engine.attachDon(engine.leader("south"), 1, "south");
    const [firstBlugoriId, secondBlugoriId] = engine.getState().players.south.characterArea as [
      string,
      string,
    ];

    bounce(engine, firstBlugoriId);
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
    engine.resolveDecision(
      "effectPlaySelection",
      { selectedIds: [engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042)] },
      "south",
    );

    bounce(engine, secondBlugoriId);

    // A second Prisoner is still in hand and a slot is still open, so nothing but
    // `oncePerTurn: true` is stopping this.
    expect(engine.getView("south").prompts).toHaveLength(0);
  });
});
