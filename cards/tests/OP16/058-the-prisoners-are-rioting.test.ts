import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op03Namule007,
  op12Buggy049,
  op12Issho082,
  op16Buggy041,
  op16PrisonerOfImpelDown042,
  op16ThePrisonersAreRioting058,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { type CardRef, OnePieceTestEngine } from "../../../src/index.ts";

// op12Buggy049 is a genuinely vanilla Character named Buggy at 7000 power; op03Namule007 is the
// same-shaped body under a different name; op12Issho082 is a vanilla 10000-power attacker. The
// Leader is OP16-041 Buggy, whose own ability is a [DON!! x1] removal trigger and stays silent
// with no DON!! attached.
//
// op16PrisonerOfImpelDown042 is the only card in the pool named "Prisoner of Impel Down". It is
// printed at 6000 with no in-game behaviour at all -- its whole effect text is the
// any-number-of-copies deck rule -- so it is a clean 6000 body to watch move to 7000.
//
// Ruling #994 asks whether a Leader that has every card's name picks up the [Main]. 是的. There is
// no grantName action in the engine, so a Leader whose STATIC name is "Prisoner of Impel Down"
// stands in: it is indistinguishable from a granted one to the `name` TargetFilter, which resolves
// through cardName(), i.e. `i18n.en.name` -- so BOTH name fields have to be overridden
// (cards/ENCODING.md).
const prisonerNamedLeader: LeaderCard = {
  ...op16Buggy041,
  id: "TEST-OP16-058-LEADER-PRISONER",
  canonicalId: "TEST-OP16-058-LEADER-PRISONER",
  name: "Prisoner of Impel Down",
  i18n: { en: { ...op16Buggy041.i18n.en, name: "Prisoner of Impel Down" } },
};

registerCards([prisonerNamedLeader]);

// The [Main] costs the event's own 1 DON!!, and donCardsOnField (shared.ts) counts active, rested
// and attached DON!! alike -- so `activeDon` here is the FIELD total, not what is left after
// paying. Everything on the board is at a printed power other than 7000 so "became 7000" can never
// be confused with "was already 7000".
function playTheMain(activeDon: number, leaderCardId: LeaderCard = op16Buggy041) {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId,
      hand: [op16ThePrisonersAreRioting058],
      character: [
        { card: op16PrisonerOfImpelDown042, playedOnTurn: 0 },
        { card: op03Namule007, playedOnTurn: 0 },
      ],
      activeDon,
    },
    {},
  );
  engine.playCard(op16ThePrisonersAreRioting058, "south");
  return engine;
}

function characterPower(engine: OnePieceTestEngine, card: CardRef) {
  const instanceId = engine.findCardInZone("south", "character", card);
  return engine.getView("south").players.south.characters.find((c) => c?.instanceId === instanceId)
    ?.power;
}

describe("OP16-058 The Prisoners Are Rioting!!", () => {
  test("[Main] with 10 DON!! on the field, every [Prisoner of Impel Down] reaches base power 7000", () => {
    // 6000 printed -> exactly 7000. The exact number is what kills `value: 7000 -> 6000`, which
    // would land the Prisoner back on its own printed power and look like nothing happened.
    const engine = playTheMain(10);

    expect(characterPower(engine, op16PrisonerOfImpelDown042)).toBe(7000);
  });

  test("[Main] a card of another name, and an ordinary Leader, are untouched", () => {
    // The name filter's negative control across both zones at once. Delete
    // `{ filter: "name", value: "Prisoner of Impel Down" }` and Namule (5000) and the Buggy Leader
    // (5000) both become 7000, so without this the mutant survives.
    const engine = playTheMain(10);

    expect(characterPower(engine, op03Namule007)).toBe(5000);
    expect(engine.getView("south").players.south.leader.power).toBe(5000);
  });

  test("[Main] with 9 DON!! on the field nothing happens", () => {
    const engine = playTheMain(9);

    expect(characterPower(engine, op16PrisonerOfImpelDown042)).toBe(6000);
  });

  test("[Main] with 11 DON!! on the field nothing happens either -- the count is exactly 10", () => {
    // Eleven DON!! cannot arise in real play (the DON!! deck holds ten), but a fixture can set it,
    // and it is the only way to tell `eq 10` from `gte 10`: under `gte` this fires.
    const engine = playTheMain(11);

    expect(characterPower(engine, op16PrisonerOfImpelDown042)).toBe(6000);
  });

  test("[Main] ruling #994: a Leader named [Prisoner of Impel Down] reaches 7000 too", () => {
    // 是的. This is what pins `zones: ["leader", "character"]` -- narrowing to ["character"] reads
    // perfectly naturally ("all of your [Prisoner of Impel Down] cards") and is wrong.
    const engine = playTheMain(10, prisonerNamedLeader);

    expect(engine.getView("south").players.south.leader.power).toBe(7000);
  });

  test("[Main] attached DON!! STACKS on the new base rather than being absorbed by it", () => {
    // The whole reason this clause needs `setBasePower` and not `setPower`: the printed reading is
    // 7000 base + 1000 for the attached DON!! = 8000. `setPower` sets TOTAL power by subtracting
    // getCardPower at resolution and would clamp this to 7000 -- indistinguishable from a Prisoner
    // with no DON!! on it at all.
    //
    // One DON!! moved from the cost area to the body leaves 9 active; the event's own cost of 1
    // then rests one of those. Ten DON!! cards are still on the field throughout.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op16Buggy041,
        hand: [op16ThePrisonersAreRioting058],
        character: [{ card: op16PrisonerOfImpelDown042, playedOnTurn: 0 }],
        activeDon: 10,
      },
      {},
    );
    const prisonerId = engine.findCardInZone("south", "character", op16PrisonerOfImpelDown042);
    engine.attachDon(prisonerId, 1, "south");
    expect(characterPower(engine, op16PrisonerOfImpelDown042)).toBe(7000);

    engine.playCard(op16ThePrisonersAreRioting058, "south");

    expect(characterPower(engine, op16PrisonerOfImpelDown042)).toBe(8000);
  });

  test("[Counter] +4000 on a [Buggy] survives a 10000-power attacker", () => {
    // 7000 + 4000 = 11000 against 10000, so Buggy lives. Mutated to +3000 he sits at exactly
    // 10000 and `attackPower >= defensePower` K.O.s him -- which is the only way the magnitude is
    // observable, since a `thisBattle` modifier is gone by the time control returns here.
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16ThePrisonersAreRioting058],
        character: [{ card: op12Buggy049, rested: true }, op03Namule007],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op12Issho082);
    const buggyId = engine.findCardInZone("north", "character", op12Buggy049);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);
    const eventId = engine.findCardInZone("north", "hand", op16ThePrisonersAreRioting058);

    engine.declareAttack(attackerId, buggyId, "south");
    engine.resolveDecision("battleCounter", { selectedIds: [eventId] }, "north");

    const boost = engine.pendingDecision("effectTargetSelection", "north").steps[0];
    if (boost?.kind !== "selectEntity") throw new Error("Expected the +4000 recipient choice.");
    // "your [Buggy]" is a card, so the Leader (also named Buggy) is offered -- and Namule, a
    // Character on the same field, is not: the name filter is the only difference between them.
    expect(boost.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [engine.leader("north"), buggyId].sort(),
    );
    expect(boost.candidates.map((candidate) => candidate.ref.id)).not.toContain(namuleId);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [buggyId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.characters.some((card) => card?.instanceId === buggyId)).toBe(true);
    expect(view.players.north.trash.map((card) => card.instanceId)).toContain(eventId);
  });

  test("without the [Counter] the same attacker K.O.s that Buggy", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op12Issho082, playedOnTurn: 0 }] },
      {
        leaderCardId: op16Buggy041,
        hand: [op16ThePrisonersAreRioting058],
        character: [{ card: op12Buggy049, rested: true }, op03Namule007],
        activeDon: 1,
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const buggyId = engine.findCardInZone("north", "character", op12Buggy049);

    engine.declareAttack(
      engine.findCardInZone("south", "character", op12Issho082),
      buggyId,
      "south",
    );
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "north");

    expect(
      engine.getView("north").players.north.characters.some((card) => card?.instanceId === buggyId),
    ).toBe(false);
  });
});
