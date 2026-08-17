import type { CharacterCard } from "@tcg/op-types";
import { op16Vista011I18n } from "./011-vista.i18n.ts";

export const op16Vista011: CharacterCard = {
  id: "OP16-011",
  canonicalId: "OP16-011",
  slug: "vista/op16-011",
  name: "Vista",
  printings: [
    {
      id: "OP16-011",
      artId: "OP16-011",
      setCode: "OP16",
      collectorNumber: "011",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-011.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 6,
  power: 8000,
  traits: ["Whitebeard Pirates"],
  attribute: "slash",
  effect:
    "[On Play] You may reveal 1 Character card with 8000 power from your hand: Draw 1 card.\n[DON!! x1] [When Attacking] K.O. up to 2 of your opponent's Characters with 2000 base power or less.",
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
              // Ruling #969: "8000 power" is exactly 8000.
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
        actions: [{ action: "draw", player: "self", amount: 1 }],
        optional: true,
      },
      {
        trigger: "whenAttacking",
        conditions: [{ condition: "donAttached", amount: 1 }],
        actions: [
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 2, upTo: true },
              // 原本的力量不高于2000 -- BASE power, so a buffed 2000-base body is still a target.
              filters: [{ filter: "basePower", comparison: "lte", value: 2000 }],
            },
          },
        ],
      },
    ],
  },
  i18n: op16Vista011I18n,
};
