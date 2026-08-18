import type { EventCard } from "@tcg/op-types";
import { op16IfYouReComingWithMeKissYourLivesGoodbye020I18n } from "./020-if-you-re-coming-with-me-kiss-your-lives-goodbye.i18n.ts";

export const op16IfYouReComingWithMeKissYourLivesGoodbye020: EventCard = {
  id: "OP16-020",
  canonicalId: "OP16-020",
  slug: "if-you-re-coming-with-me-kiss-your-lives-goodbye/op16-020",
  name: "If You're Coming with Me... Kiss Your Lives Goodbye!!",
  printings: [
    {
      id: "OP16-020",
      artId: "OP16-020",
      setCode: "OP16",
      collectorNumber: "020",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-020.png",
    },
  ],
  cardType: "event",
  color: ["red"],
  rarity: "UC",
  setId: "OP16",
  cost: 0,
  traits: ["The Four Emperors", "Whitebeard Pirates"],
  effect:
    "[Main] You may rest 1 of your DON!! cards and reveal 1 Character card with 8000 power from your hand: Draw 1 card.\n[Counter] You may trash 1 card from your hand: Up to 1 of your Leader or Character cards gains +3000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        costs: [
          { cost: "restDon", amount: 1 },
          {
            cost: "revealFromHand",
            amount: 1,
            filters: [
              { filter: "cardCategory", value: "character" },
              // Ruling #975: "a Character card with 8000 power" is exactly 8000, as on OP16-002
              // Izo (#962).
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
        actions: [{ action: "draw", player: "self", amount: 1 }],
        optional: true,
      },
      {
        // A separate block with its own cost and its own copy of nothing else -- the [Main] and
        // [Counter] halves of this card share no filter, so neither can be derived from the other.
        trigger: "counter",
        costs: [{ cost: "trashFromHand", amount: 1 }],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
            },
            value: 3000,
            duration: "thisBattle",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16IfYouReComingWithMeKissYourLivesGoodbye020I18n,
};
