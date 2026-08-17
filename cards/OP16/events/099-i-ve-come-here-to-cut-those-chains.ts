import type { EventCard } from "@tcg/op-types";
import { op16IVeComeHereToCutThoseChains099I18n } from "./099-i-ve-come-here-to-cut-those-chains.i18n.ts";

export const op16IVeComeHereToCutThoseChains099: EventCard = {
  id: "OP16-099",
  canonicalId: "OP16-099",
  slug: "i-ve-come-here-to-cut-those-chains/op16-099",
  name: "I've Come Here... To Cut Those Chains!!!",
  printings: [
    {
      id: "OP16-099",
      artId: "OP16-099",
      setCode: "OP16",
      collectorNumber: "099",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-099.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  traits: ["Land of Wano"],
  effect:
    "[Main] You may rest 6 of your DON!! cards: Trash 5 cards from the top of your deck. Then, play up to 1 [Land of Wano] type Character card with a cost of 6 or less from your trash.\n[Counter] Your Leader gains +3000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        costs: [{ cost: "restDon", amount: 6 }],
        actions: [
          { action: "trashFromDeck", player: "self", amount: 5 },
          {
            // Sequenced after the mill rather than hung off it as `thenActions`, so the play is
            // not gated on the mill having moved anything -- and the five just-milled cards are
            // themselves legal candidates, which is the whole point of the combination.
            action: "play",
            source: { player: "self", zone: "trash" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "trait", value: "Land of Wano", match: "includes" },
              { filter: "cost", comparison: "lte", value: 6 },
              // Load-bearing: OP02-048 Land of Wano is a cost-1 Stage with the trait, and
              // candidatesForPlayAction admits stages as well as characters
              // (cards/ENCODING.md, OP16-029).
              { filter: "cardCategory", value: "character" },
            ],
          },
        ],
        optional: true,
      },
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 3000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op16IVeComeHereToCutThoseChains099I18n,
};
