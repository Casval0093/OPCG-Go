import type { CharacterCard } from "@tcg/op-types";
import { op15Viola040I18n } from "./040-viola.i18n.ts";

export const op15Viola040: CharacterCard = {
  id: "OP15-040",
  canonicalId: "OP15-040",
  slug: "viola/op15-040",
  name: "Viola",
  printings: [
    {
      id: "OP15-040",
      artId: "OP15-040",
      setCode: "OP15",
      collectorNumber: "040",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-040.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Dressrosa", "Donquixote Pirates"],
  attribute: "special",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Dressrosa] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            // "[Dressrosa] type **card**", not "Character card" -- deliberately no
            // `cardCategory` filter, unlike OP10-059 (which prints "Character card") and unlike
            // OP15-044 Koala (which prints "Event"). An Event or Stage with the type is a legal
            // reveal here. Shape from OP16-026 Emporio.Ivankov / OP04-039 Rebecca.
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
  },
  i18n: op15Viola040I18n,
};
