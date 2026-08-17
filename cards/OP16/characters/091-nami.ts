import type { CharacterCard } from "@tcg/op-types";
import { op16Nami091I18n } from "./091-nami.i18n.ts";

export const op16Nami091: CharacterCard = {
  id: "OP16-091",
  canonicalId: "OP16-091",
  slug: "nami/op16-091",
  name: "Nami",
  printings: [
    {
      id: "OP16-091",
      artId: "OP16-091",
      setCode: "OP16",
      collectorNumber: "091",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-091.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Land of Wano", "Straw Hat Crew"],
  attribute: "special",
  effect:
    "[On Play] If your Leader has the [Land of Wano] type, look at 4 cards from the top of your deck; reveal up to 1 [Land of Wano] type card other than [Nami] and add it to your hand. Then, trash the rest.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        conditions: [{ condition: "leaderTrait", trait: "Land of Wano", match: "includes" }],
        actions: [
          {
            // Same shape as OP04-092 Rebecca, which prints this line verbatim at lookCount 3
            // with its own name excluded. "type CARD", so no cardCategory filter.
            action: "search",
            lookCount: 4,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [
              { filter: "trait", value: "Land of Wano", match: "includes" },
              { filter: "excludeName", value: "Nami" },
            ],
            revealDestination: "hand",
            remainderPosition: "trash",
          },
        ],
      },
    ],
  },
  i18n: op16Nami091I18n,
};
