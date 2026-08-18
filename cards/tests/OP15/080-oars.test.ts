import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  op01MonkeyDLuffy003,
  op02Thatch007,
  op06GeckoMoria086,
  op12Shiki005,
  op14eb04Oars101,
  op15Oars080,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// Ruling #921 asks about a Leader printed "has every card's name, trait and attribute". The
// engine has no `grantName` action, but it does not need one to reproduce what such a Leader
// looks like to `cardNames()`: that reads `[cardName(card), ...card.alternateNames]`, so a
// STATIC pair of names is indistinguishable from a granted one. Overriding `name` alone is not
// enough -- `cardName()` resolves from `i18n.en.name`.
function namedLeader(
  id: string,
  name: string,
  power: number,
  alternateNames?: string[],
): LeaderCard {
  return {
    ...op01MonkeyDLuffy003,
    id,
    canonicalId: id,
    name,
    power,
    ...(alternateNames ? { alternateNames } : {}),
    i18n: { en: { ...op01MonkeyDLuffy003.i18n.en, name } },
    effects: undefined,
  };
}

// Named Gecko Moria and already at 10000, exactly as #921 stipulates.
const moriaLeader = namedLeader("TEST-OP15-080-MORIA-LEADER", "Gecko Moria", 10000);
// The same, but ALSO named Oars -- the "every name" Leader the ruling is actually about.
const everyNameLeader = namedLeader("TEST-OP15-080-EVERY-NAME", "Gecko Moria", 10000, ["Oars"]);

registerCards([moriaLeader, everyNameLeader]);

// op01MonkeyDLuffy003 is named neither Gecko Moria nor Oars, so the default board supplies
// neither half of the condition by accident.
function boardWith(
  character: PlayerFixture["character"],
  leaderCardId: LeaderCard = op01MonkeyDLuffy003,
) {
  return OnePieceTestEngine.create(
    { leaderCardId, character: [op15Oars080, ...(character ?? [])], activeDon: 3, deck: 10 },
    {},
  );
}

function oarsPower(engine: OnePieceTestEngine) {
  const oarsId = engine.findCardInZone("south", "character", op15Oars080);
  const card = engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === oarsId);
  if (!card || card.power === null) throw new Error("Oars was not projected with a power.");
  return card.power;
}

describe("OP15-080 Oars", () => {
  test("a 9000 Gecko Moria is under the line; one DON!! takes it to 10000 and the buff lands", () => {
    // op06GeckoMoria086 prints 8/9000 -- exactly one power step below, which is what kills
    // `value: 10000 -> 9000`. The DON!! half also settles 力量 vs 原本的力量: the printed text is
    // plain 力量, so a 9000-base body carrying an attached DON!! DOES qualify.
    const engine = boardWith([op06GeckoMoria086]);
    const moriaId = engine.findCardInZone("south", "character", op06GeckoMoria086);

    expect(oarsPower(engine)).toBe(0);

    engine.attachDon(moriaId, 1, "south");

    // Exactly 7000: Oars prints 0 power, so this also pins `value: 7000` against its own mutant.
    expect(oarsPower(engine)).toBe(7000);
  });

  test("a 10000-power body that is not a [Gecko Moria] does nothing", () => {
    // op12Shiki005 is a vanilla 8/10000. Without the name filter it would satisfy the condition.
    expect(oarsPower(boardWith([op12Shiki005]))).toBe(0);
  });

  test("a second [Oars] on the field switches the buff off", () => {
    const engine = boardWith([op06GeckoMoria086, op14eb04Oars101]);
    engine.attachDon(engine.findCardInZone("south", "character", op06GeckoMoria086), 1, "south");

    expect(oarsPower(engine)).toBe(0);
  });

  test('ruling #921: a Leader with "every card name" at 10000 power grants NOTHING', () => {
    // 不会. Read carelessly this looks like a reversal of rulings #979/#993 -- it is not. The
    // Leader DOES satisfy the [Gecko Moria] half, exactly as those rulings require; it then
    // fails the second half, because a Leader with every name is also an [Oars]. Narrow either
    // scan to `zone: "character"` and the Leader stops counting as an Oars, the buff wrongly
    // applies, and this test goes red.
    expect(oarsPower(boardWith([], everyNameLeader))).toBe(0);
  });

  test("a Leader that is only a 10000 [Gecko Moria] does grant the buff", () => {
    // The other side of the same zone question, and the only thing that kills
    // `zone field -> character` on the first condition: with no Moria Character anywhere, the
    // Leader has to be inside the scan for this to fire at all.
    expect(oarsPower(boardWith([], moriaLeader))).toBe(7000);
  });

  test("ruling #920: paying the [On K.O.] with this card itself means it is NOT played", () => {
    // 可以...这种情况下，此角色卡牌不会登场. Both halves follow from the cost carrying no filter:
    // Oars is in the trash when its own [On K.O.] resolves, so it is a legal payment, and once
    // paid away the `self: true` play pool no longer contains it.
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        character: [{ card: op15Oars080, rested: true }],
        trash: 3,
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const oarsId = engine.findCardInZone("south", "character", op15Oars080);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, oarsId, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    // 4 cards in the trash (3 filler + Oars) against an amount of 3, so a real payment prompt
    // appears and Oars is visibly among the options.
    const payment = engine.pendingDecision("effectCostReturnTrashToDeck", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected the trash-to-deck payment.");
    const options = payment.candidates.map((candidate) => candidate.ref.id);
    expect(options).toContain(oarsId);

    const paid = [oarsId, ...options.filter((id) => id !== oarsId).slice(0, 2)];
    engine.resolveDecision("effectCostReturnTrashToDeck", { selectedIds: paid }, "south");

    const state = engine.getState();
    expect(state.cards[oarsId]?.zone).toBe("deck");
    expect(state.players.south.characterArea.filter(Boolean)).toHaveLength(0);
    // 放回卡组最下方 -- the BOTTOM of the deck. Order within the three is the player's ("in any
    // order"), so this asserts the set rather than the sequence; without it `position: "top"`
    // would read identically.
    expect(state.players.south.deck.slice(-3).sort()).toEqual([...paid].sort());
    expect(state.players.south.deck).toHaveLength(13);
  });

  test("paying with three OTHER cards brings this Character back to the field", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        character: [{ card: op15Oars080, rested: true }],
        trash: 3,
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const oarsId = engine.findCardInZone("south", "character", op15Oars080);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, oarsId, "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const payment = engine.pendingDecision("effectCostReturnTrashToDeck", "south").steps[0];
    if (payment?.kind !== "payCost") throw new Error("Expected the trash-to-deck payment.");
    const others = payment.candidates
      .map((candidate) => candidate.ref.id)
      .filter((id) => id !== oarsId);

    engine.resolveDecision("effectCostReturnTrashToDeck", { selectedIds: others }, "south");

    expect(engine.getState().cards[oarsId]?.zone).toBe("character");
  });

  test('declining the [On K.O.] leaves everything alone -- it is a "may"', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op01MonkeyDLuffy003,
        character: [{ card: op15Oars080, rested: true }],
        trash: 3,
        deck: 10,
      },
      { character: [{ card: op02Thatch007, playedOnTurn: 0 }] },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const oarsId = engine.findCardInZone("south", "character", op15Oars080);
    const attackerId = engine.findCardInZone("north", "character", op02Thatch007);

    engine.declareAttack(attackerId, oarsId, "north");
    engine.resolveDecision("effectOptional", { optionId: "no" }, "south");

    const state = engine.getState();
    expect(state.cards[oarsId]?.zone).toBe("trash");
    expect(state.players.south.trash).toHaveLength(4);
    expect(state.players.south.deck).toHaveLength(10);
  });
});
