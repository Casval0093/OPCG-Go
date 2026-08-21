import type { CharacterCard } from "@tcg/op-types";
import { st12EmporioIvankov010I18n } from "./010-emporio-ivankov.i18n.ts";

export const st12EmporioIvankov010: CharacterCard = {
  id: "ST12-010",
  canonicalId: "ST12-010",
  slug: "emporio-ivankov/st12-010",
  name: "Emporio.Ivankov",
  printings: [
    {
      id: "ST12-010",
      artId: "ST12-010",
      setCode: "ST12",
      collectorNumber: "010",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/ST12-010.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "ST12",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Impel Down", "Revolutionary Army"],
  attribute: "special",
  effect:
    "[On Play] Reveal 1 card from the top of your deck and play up to 1 Character card with a cost of 2. Then, place the rest at the top or bottom of your deck.\n[When Attacking] [Once Per Turn] Draw 1 card if you have 6 or less cards in your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Same reveal-then-play shape as ST12-017 Plastic Surgery Shot. `topOnly: true` is
        // ruling #163: the play is the revealed deck-top card, never a cost-2 Character
        // sitting in hand. `finalPosition: "choice"` is the leftover revealed card
        // (ruling #164), skipped by the engine if that card left the deck because it was
        // played.
        actions: [
          {
            action: "revealTopDeckCard",
            player: "self",
            conditional: {
              filters: [
                { filter: "cardCategory", value: "character" },
                { filter: "cost", comparison: "eq", value: 2 },
              ],
              actions: [
                {
                  action: "play",
                  source: { player: "self", zone: "deck" },
                  count: { amount: 1, upTo: true },
                  filters: [
                    { filter: "cardCategory", value: "character" },
                    { filter: "cost", comparison: "eq", value: 2 },
                  ],
                  topOnly: true,
                },
              ],
            },
            finalPosition: "choice",
          },
        ],
      },
      {
        trigger: "whenAttacking",
        conditions: [{ condition: "handCount", player: "self", comparison: "lte", value: 6 }],
        actions: [{ action: "draw", player: "self", amount: 1 }],
        oncePerTurn: true,
      },
    ],
  },
  i18n: st12EmporioIvankov010I18n,
};
