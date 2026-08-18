import type { CharacterCard } from "@tcg/op-types";
import { op15Margarita091I18n } from "./091-margarita.i18n.ts";

export const op15Margarita091: CharacterCard = {
  id: "OP15-091",
  canonicalId: "OP15-091",
  slug: "margarita/op15-091",
  name: "Margarita",
  printings: [
    {
      id: "OP15-091",
      artId: "OP15-091",
      setCode: "OP15",
      collectorNumber: "091",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-091.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 2000,
  traits: ["The Owner of Cindry's Shadow"],
  attribute: "wisdom",
  effect:
    "[On Play] Place up to 1 card from your opponent's trash at the bottom of the owner's deck.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "returnToDeck",
            // No filter: "1 card", any type.
            target: { player: "opponent", zones: ["trash"], count: { amount: 1, upTo: true } },
            position: "bottom",
            // "the OWNER's deck" needs no `destinationPlayer`: `returnToDeckDestination` falls
            // back to `getInstance(state, targetId).owner` when the field is absent, which is
            // the owner by definition. Setting `destinationPlayer: "opponent"` would encode
            // "the effect controller's opponent" instead -- the same seat here only by
            // coincidence of the target zone, and wrong if the card were ever owned otherwise.
          },
        ],
      },
    ],
  },
  i18n: op15Margarita091I18n,
};
