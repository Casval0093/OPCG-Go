import type { CharacterCard } from "@tcg/op-types";
import { op15GanFall102I18n } from "./102-gan-fall.i18n.ts";

export const op15GanFall102: CharacterCard = {
  id: "OP15-102",
  canonicalId: "OP15-102",
  slug: "gan-fall/op15-102",
  name: "Gan.Fall",
  printings: [
    {
      id: "OP15-102",
      artId: "OP15-102",
      setCode: "OP15",
      collectorNumber: "102",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-102.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 2000,
  traits: ["Sky Island"],
  attribute: "slash",
  effect:
    "If you have a [Sky Island] type Character with 7000 power or more, give this card in your hand -3 cost.\n[On Play] Rest up to 1 of your opponent's Characters with a cost equal to or less than the number of your opponent's Life cards.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              // Exactly the printed sentence OP05-102 Gedatsu carries, word for word, and the
              // reason `dynamicCost` exists. It compares the candidate's `baseCost` against the
              // OPPONENT's Life count, so both halves move: a cost-3 body stops being legal the
              // moment the opponent drops to 2 Life.
              filters: [{ filter: "dynamicCost", comparison: "lte", source: "opponentLifeCount" }],
            },
          },
        ],
      },
    ],
    permanentEffects: [
      {
        // "a [Sky Island] type CHARACTER" explicitly scopes to the character zone -- unlike the
        // "if you have [Name]" pattern, which scans the field including the Leader. That matters
        // here because OP05-098 Enel and OP08-098 Kalgara are both [Sky Island] Leaders.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "character",
            filters: [
              { filter: "trait", value: "Sky Island", match: "includes" },
              // Plain 力量, not 原本的力量: `power`, so a 5000-base body holding attached DON!! or
              // a +2000 modifier does qualify.
              { filter: "power", comparison: "gte", value: 7000 },
            ],
          },
        ],
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["hand"], count: { amount: 1 }, self: true },
            value: -3,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15GanFall102I18n,
};
