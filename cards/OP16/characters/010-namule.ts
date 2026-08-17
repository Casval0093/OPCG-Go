import type { CharacterCard } from "@tcg/op-types";
import { op16Namule010I18n } from "./010-namule.i18n.ts";

export const op16Namule010: CharacterCard = {
  id: "OP16-010",
  canonicalId: "OP16-010",
  slug: "namule/op16-010",
  name: "Namule",
  printings: [
    {
      id: "OP16-010",
      artId: "OP16-010",
      setCode: "OP16",
      collectorNumber: "010",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-010.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Fish-Man", "Whitebeard Pirates"],
  attribute: "strike",
  effect:
    "[On Play] You may reveal 1 Character card with 8000 power from your hand: K.O. up to 1 of your opponent's Characters with 2000 base power or less.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        costs: [
          {
            cost: "revealFromHand",
            amount: 1,
            filters: [
              { filter: "cardCategory", value: "character" },
              // Ruling #968: "8000 power" is exactly 8000.
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
        actions: [
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              // 原本的力量不高于2000 -- BASE power, so a buffed 2000-base body is still a target.
              filters: [{ filter: "basePower", comparison: "lte", value: 2000 }],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16Namule010I18n,
};
