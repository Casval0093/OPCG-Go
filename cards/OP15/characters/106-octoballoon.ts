import type { CharacterCard } from "@tcg/op-types";
import { op15Octoballoon106I18n } from "./106-octoballoon.i18n.ts";

export const op15Octoballoon106: CharacterCard = {
  id: "OP15-106",
  canonicalId: "OP15-106",
  slug: "octoballoon/op15-106",
  name: "Octoballoon",
  printings: [
    {
      id: "OP15-106",
      artId: "OP15-106",
      setCode: "OP15",
      collectorNumber: "106",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-106.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 2,
  power: 0,
  counter: 1000,
  trigger:
    "Draw 1 card. Then, play up to 1 yellow Character or Stage card with a cost of 2 or less from your hand.",
  traits: ["Animal", "Sky Island"],
  attribute: "wisdom",
  effects: {
    effects: [
      {
        trigger: "trigger",
        actions: [
          { action: "draw", player: "self", amount: 1 },
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            // Deliberately NO `cardCategory` filter: "Character or Stage" is exactly the pool
            // `candidatesForPlayAction` already restricts every `play` action to, so the printed
            // wording adds nothing here. (On OP15-109 and OP15-112, which print "Character card",
            // the filter IS present and does the work of excluding Stages.)
            filters: [
              { filter: "color", value: "yellow" },
              { filter: "cost", comparison: "lte", value: 2 },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15Octoballoon106I18n,
};
