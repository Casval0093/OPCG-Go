import type { CharacterCard } from "@tcg/op-types";
import { op14eb04Borsalino058I18n } from "./058-borsalino.i18n.ts";

export const op14eb04Borsalino058: CharacterCard = {
  id: "EB04-058",
  canonicalId: "EB04-058",
  slug: "borsalino/eb04-058",
  name: "Borsalino",
  printings: [
    {
      id: "EB04-058",
      artId: "EB04-058",
      setCode: "OP14EB04",
      collectorNumber: "058",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/EB04-058.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SR",
  setId: "OP14EB04",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Egghead", "Navy"],
  attribute: "special",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] If you have 2 or less Life cards, add up to 1 card from the top of your deck to the top of your Life cards.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        // Same yellow deck-top → life-top verb as OP15-110 Braham / OP15-116: `addToLife`
        // from `zones: ["deck"]` with `position: "top"`. That is NOT `searchRevealToLife`
        // (look N, add 1 to life, rest to bottom — OP16-119, a different parked primitive).
        conditions: [{ condition: "lifeCount", player: "self", comparison: "lte", value: 2 }],
        actions: [
          {
            action: "addToLife",
            target: { player: "self", zones: ["deck"], count: { amount: 1, upTo: true } },
            position: "top",
          },
        ],
      },
    ],
  },
  i18n: op14eb04Borsalino058I18n,
};
