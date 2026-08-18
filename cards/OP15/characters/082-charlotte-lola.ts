import type { CharacterCard } from "@tcg/op-types";
import { op15CharlotteLola082I18n } from "./082-charlotte-lola.i18n.ts";

export const op15CharlotteLola082: CharacterCard = {
  id: "OP15-082",
  canonicalId: "OP15-082",
  slug: "charlotte-lola/op15-082",
  name: "Charlotte Lola",
  printings: [
    {
      id: "OP15-082",
      artId: "OP15-082",
      setCode: "OP15",
      collectorNumber: "082",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-082.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Rolling Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Trash 3 cards from the top of your deck.\n[On K.O.] Add up to 1 of your Character cards with a cost of 8 or less from your trash to your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [{ action: "trashFromDeck", player: "self", amount: 3 }],
      },
      {
        // Ruling #922: this may add ITSELF (可以) -- Lola is cost 4, and she is already in the
        // trash by the time her own [On K.O.] resolves. Same zone fact as Absalom's #918. No
        // `excludeSelf`.
        trigger: "onKo",
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [
                // Load-bearing next to a `cost` filter, unlike next to a `power` filter: Events
                // and Stages have real printed costs, and a `returnToHand` target over the trash
                // has no card-type pre-filter (the pre-filter is specific to `play`).
                { filter: "cardCategory", value: "character" },
                { filter: "cost", comparison: "lte", value: 8 },
              ],
            },
          },
        ],
      },
    ],
  },
  i18n: op15CharlotteLola082I18n,
};
