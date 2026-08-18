import type { CharacterCard } from "@tcg/op-types";
import { op15Kotori064I18n } from "./064-kotori.i18n.ts";

export const op15Kotori064: CharacterCard = {
  id: "OP15-064",
  canonicalId: "OP15-064",
  slug: "kotori/op15-064",
  name: "Kotori",
  printings: [
    {
      id: "OP15-064",
      artId: "OP15-064",
      setCode: "OP15",
      collectorNumber: "064",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-064.png",
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
    "[Activate: Main] DON!! -2, You may rest this Character: If you have [Satori] and [Hotori], rest up to 1 of your opponent's Characters with 5000 power or less.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "returnDon", amount: 2 }, { cost: "restThisCard" }],
        actions: [
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "power", comparison: "lte", value: 5000 }],
            },
            // The name check sits AFTER the cost colon, so it gates the payload only: the 2 DON!!
            // and the rest are payable with neither name on the field and buy nothing (OP16-070's
            // placement). Ruling #905 pins two things the English leaves open: `zone: "field"`,
            // because a Leader that has every card's name satisfies BOTH names by itself with zero
            // Satori/Hotori Characters anywhere (可以) -- `zone: "character"` would exclude it, the
            // Antlerkov #979 bug -- and `player: "self"`, from 我方场上 in the quoted SC text.
            condition: {
              condition: "compound",
              operator: "and",
              conditions: [
                {
                  condition: "hasCard",
                  player: "self",
                  zone: "field",
                  filters: [{ filter: "name", value: "Satori" }],
                },
                {
                  condition: "hasCard",
                  player: "self",
                  zone: "field",
                  filters: [{ filter: "name", value: "Hotori" }],
                },
              ],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Kotori064I18n,
};
