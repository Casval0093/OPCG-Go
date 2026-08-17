import type { CharacterCard } from "@tcg/op-types";
import { op16EmporioIvankov026I18n } from "./026-emporio-ivankov.i18n.ts";

export const op16EmporioIvankov026: CharacterCard = {
  id: "OP16-026",
  canonicalId: "OP16-026",
  slug: "emporio-ivankov/op16-026",
  name: "Emporio.Ivankov",
  printings: [
    {
      id: "OP16-026",
      artId: "OP16-026",
      setCode: "OP16",
      collectorNumber: "026",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-026.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 4000,
  counter: 1000,
  traits: ["Impel Down", "Revolutionary Army"],
  attribute: "special",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Impel Down] type card, add it to your hand and place the rest at the bottom of your deck in any order. Then, play up to 1 Character card with a cost of 2 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Ruling #978: the "Then, play ..." half fires even when the look-3 added NOTHING to
        // hand (可以). Two independent actions in one block is exactly that -- the play is not
        // hung off the search's `thenActions`, which would make it conditional on a reveal.
        // "[Impel Down] type" is the trait 《因佩尔地狱》, not a card name. Search half modeled
        // on OP02/stages/092-impel-down.ts, which looks at the same 3 for the same trait.
        actions: [
          {
            action: "search",
            lookCount: 3,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [{ filter: "trait", value: "Impel Down", match: "includes" }],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "cost", comparison: "lte", value: 2 },
              { filter: "cardCategory", value: "character" },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16EmporioIvankov026I18n,
};
