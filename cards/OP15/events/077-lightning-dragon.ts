import type { EventCard } from "@tcg/op-types";
import { op15LightningDragon077I18n } from "./077-lightning-dragon.i18n.ts";

export const op15LightningDragon077: EventCard = {
  id: "OP15-077",
  canonicalId: "OP15-077",
  slug: "lightning-dragon/op15-077",
  name: "Lightning Dragon",
  printings: [
    {
      id: "OP15-077",
      artId: "OP15-077",
      setCode: "OP15",
      collectorNumber: "077",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-077.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "R",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: Draw 1 card. Then, up to 1 of your opponent's rested Characters with 6000 power or less will not become active in your opponent's next Refresh Phase.",
  effects: {
    effects: [
      {
        trigger: "main",
        // NO [Enel] condition on this one, unlike OP15-074/075/076 -- neither the printed English nor
        // the SC text quoted in ruling #916 carries one. Do not add it by analogy with its siblings.
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          { action: "draw", player: "self", amount: 1 },
          {
            action: "freeze",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [
                { filter: "state", value: "rested" },
                { filter: "power", comparison: "lte", value: 6000 },
              ],
            },
          },
        ],
      },
    ],
  },
  i18n: op15LightningDragon077I18n,
};
