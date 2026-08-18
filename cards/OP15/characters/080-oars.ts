import type { CharacterCard } from "@tcg/op-types";
import { op15Oars080I18n } from "./080-oars.i18n.ts";

export const op15Oars080: CharacterCard = {
  id: "OP15-080",
  canonicalId: "OP15-080",
  slug: "oars/op15-080",
  name: "Oars",
  printings: [
    {
      id: "OP15-080",
      artId: "OP15-080",
      setCode: "OP15",
      collectorNumber: "080",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-080.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 0,
  counter: 1000,
  traits: ["Giant", "Thriller Bark Pirates"],
  attribute: "strike",
  effect:
    "If you have [Gecko Moria] with 10000 power or more on your field and there are no other [Oars] cards, this Character gains +7000 power.\n[On K.O.] You may place 3 cards from your trash at the bottom of your deck in any order: Play this Character card from your trash.",
  effects: {
    permanentEffects: [
      {
        // Ruling #921 is the whole reason both halves are shaped this way. Asked whether a
        // Leader printed "has every card's name, trait and attribute" -- already at 10000 power
        // -- turns this buff on, the SC answers 不会 (no). That is NOT the Antlerkov #979 lesson
        // being reversed: such a Leader satisfies the [Gecko Moria] half exactly as #979/#993
        // say it should, and then FAILS the second half, because a Leader with every name is
        // also an [Oars]. So the ruling actually pins three things at once: the Leader is inside
        // both scans (hence `zone: "field"`, not `"character"`), "other" excludes this Character
        // but nothing else (hence `excludeSelf` and no other exclusion), and the two clauses are
        // ANDed. 我方场上 leads the SC sentence and the second clause elides the locative rather
        // than replacing it, so `player: "self"` governs both -- an opponent's Oars does not
        // switch this off.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "field",
            filters: [
              { filter: "name", value: "Gecko Moria" },
              // Plain 力量 (not 原本的力量), so current power: a 9000-power Moria carrying one
              // attached DON!! does satisfy this on your own turn.
              { filter: "power", comparison: "gte", value: 10000 },
            ],
          },
          {
            condition: "notHasCard",
            player: "self",
            zone: "field",
            filters: [{ filter: "name", value: "Oars" }, { filter: "excludeSelf" }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 7000,
            duration: "permanent",
          },
        ],
      },
    ],
    effects: [
      {
        // Ruling #920: the 3 cards placed at the bottom of the deck may INCLUDE this card
        // itself, and then it does not get played (此角色卡牌不会登场). Both halves are automatic
        // as long as the cost carries no filter -- Oars is in the trash when its own [On K.O.]
        // resolves, so it is a legal payment, and once paid away the `play` action's
        // `self: true` pool no longer contains it. Do not add a filter to "protect" the card.
        trigger: "onKo",
        costs: [{ cost: "returnTrashToDeck", amount: 3, position: "bottom" }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "trash" },
            count: { amount: 1 },
            self: true,
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Oars080I18n,
};
