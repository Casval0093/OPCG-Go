import type { CharacterCard } from "@tcg/op-types";
import { op15Rebecca053I18n } from "./053-rebecca.i18n.ts";

export const op15Rebecca053: CharacterCard = {
  id: "OP15-053",
  canonicalId: "OP15-053",
  slug: "rebecca/op15-053",
  name: "Rebecca",
  printings: [
    {
      id: "OP15-053",
      artId: "OP15-053",
      setCode: "OP15",
      collectorNumber: "053",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-053.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Dressrosa"],
  attribute: "wisdom",
  effect:
    "[DON!! x1] This Character gains [Blocker].\n[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Dressrosa] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  effects: {
    effects: [
      {
        // Identical to OP15-040 Viola's [On Play]: "[Dressrosa] type **card**", so no
        // `cardCategory` filter.
        trigger: "onPlay",
        actions: [
          {
            action: "search",
            lookCount: 3,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [{ filter: "trait", value: "Dressrosa", match: "includes" }],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
    ],
    permanentEffects: [
      {
        // [DON!! x1] is the `donAttached` condition over this card's own attached DON!!, gating a
        // permanent grantKeyword. Shape copied from OP03-090 Blueno, whose printed first clause
        // is this one verbatim.
        conditions: [{ condition: "donAttached", amount: 1 }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "blocker",
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Rebecca053I18n,
};
