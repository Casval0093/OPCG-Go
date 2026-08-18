import type { CharacterCard } from "@tcg/op-types";
import { op15Raki112I18n } from "./112-raki.i18n.ts";

export const op15Raki112: CharacterCard = {
  id: "OP15-112",
  canonicalId: "OP15-112",
  slug: "raki/op15-112",
  name: "Raki",
  printings: [
    {
      id: "OP15-112",
      artId: "OP15-112",
      setCode: "OP15",
      collectorNumber: "112",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-112.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 1000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "ranged",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] Play up to 1 [Shandian Warrior] type Character card with a cost of 3 or less from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        // Not optional: no "may" and no cost, so the play offer is mandatory. GENERAL ruling #5
        // makes "up to 1" a real 0-or-1 choice regardless.
        trigger: "onPlay",
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "trait", value: "Shandian Warrior", match: "includes" },
              { filter: "cost", comparison: "lte", value: 3 },
              // "Character card": excludes Stages from the already character-or-stage pool
              // `candidatesForPlayAction` builds.
              { filter: "cardCategory", value: "character" },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15Raki112I18n,
};
