import type { CharacterCard } from "@tcg/op-types";
import { op15Hotori072I18n } from "./072-hotori.i18n.ts";

export const op15Hotori072: CharacterCard = {
  id: "OP15-072",
  canonicalId: "OP15-072",
  slug: "hotori/op15-072",
  name: "Hotori",
  printings: [
    {
      id: "OP15-072",
      artId: "OP15-072",
      setCode: "OP15",
      collectorNumber: "072",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-072.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "[Activate: Main] DON!! -2, You may rest this Character: If you have [Kotori] and [Satori], give up to 1 of your opponent's Characters -3000 power during this turn.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "returnDon", amount: 2 }, { cost: "restThisCard" }],
        actions: [
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -3000,
            duration: "thisTurn",
            // Post-colon placement gates the payload only -- the costs are payable with neither
            // name present and buy nothing. Ruling #911 is the twin of #905 on OP15-064 Kotori:
            // a Leader with every card's name satisfies both names alone, so the scan must be
            // `zone: "field"`, and 我方场上 pins `player: "self"`.
            condition: {
              condition: "compound",
              operator: "and",
              conditions: [
                {
                  condition: "hasCard",
                  player: "self",
                  zone: "field",
                  filters: [{ filter: "name", value: "Kotori" }],
                },
                {
                  condition: "hasCard",
                  player: "self",
                  zone: "field",
                  filters: [{ filter: "name", value: "Satori" }],
                },
              ],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Hotori072I18n,
};
