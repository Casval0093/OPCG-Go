import type { CharacterCard } from "@tcg/op-types";
import { op16DonquixoteRosinante070I18n } from "./070-donquixote-rosinante.i18n.ts";

export const op16DonquixoteRosinante070: CharacterCard = {
  id: "OP16-070",
  canonicalId: "OP16-070",
  slug: "donquixote-rosinante/op16-070",
  name: "Donquixote Rosinante",
  printings: [
    {
      id: "OP16-070",
      artId: "OP16-070",
      setCode: "OP16",
      collectorNumber: "070",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-070.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Navy", "Donquixote Pirates"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] You may rest 2 of your DON!! cards: If your Leader has the [Navy] type, add up to 1 DON!! card from your DON!! deck and rest it.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        // The [Navy] check follows the cost colon, so it gates the payload only: you may pay 2
        // rested DON!! with a non-Navy Leader and get nothing (OP04-060 Crocodile's placement).
        // Net-negative on purpose — that is why the "may" matters and `optional: true` is here.
        trigger: "onPlay",
        costs: [{ cost: "restDon", amount: 2 }],
        actions: [
          {
            action: "addDon",
            count: { amount: 1, upTo: true },
            state: "rested",
            condition: { condition: "leaderTrait", trait: "Navy", match: "includes" },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16DonquixoteRosinante070I18n,
};
