import type { CharacterCard } from "@tcg/op-types";
import { op16Usopp043I18n } from "./043-usopp.i18n.ts";

export const op16Usopp043: CharacterCard = {
  id: "OP16-043",
  canonicalId: "OP16-043",
  slug: "usopp/op16-043",
  name: "Usopp",
  printings: [
    {
      id: "OP16-043",
      artId: "OP16-043",
      setCode: "OP16",
      collectorNumber: "043",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-043.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Dressrosa", "Straw Hat Crew"],
  attribute: "ranged",
  effect:
    "[Blocker]\n[On K.O.] You may rest 1 of your [Dressrosa] type Leader or Stage cards: Return up to 1 of your opponent's Characters with a cost of 5 or less to the owner's hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onKo",
        costs: [
          {
            // `restCards` scans leader + characterArea + stageArea of the controller
            // (candidatesForRestCardsCost, effects/actions.ts), so the "Leader or Stage"
            // half of the printed text has to be spelled out as a cardCategory restriction
            // -- otherwise every Dressrosa CHARACTER is a legal payment too, and this card
            // and most of its deck-mates are Dressrosa Characters. Same shape as OP10-043
            // Moocy and OP10-091 Brook, the two existing cards printed with this wording.
            cost: "restCards",
            amount: 1,
            filters: [
              { filter: "trait", value: "Dressrosa", match: "includes" },
              {
                filter: "anyOf",
                groups: [
                  [{ filter: "cardCategory", value: "leader" }],
                  [{ filter: "cardCategory", value: "stage" }],
                ],
              },
            ],
          },
        ],
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 5 }],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16Usopp043I18n,
};
