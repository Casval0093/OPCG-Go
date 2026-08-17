import type { CharacterCard } from "@tcg/op-types";
import { op16Antlerkov029I18n } from "./029-antlerkov.i18n.ts";

export const op16Antlerkov029: CharacterCard = {
  id: "OP16-029",
  canonicalId: "OP16-029",
  slug: "antlerkov/op16-029",
  name: "Antlerkov",
  printings: [
    {
      id: "OP16-029",
      artId: "OP16-029",
      setCode: "OP16",
      collectorNumber: "029",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-029.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 3000,
  counter: 2000,
  traits: ["Impel Down"],
  attribute: "ranged",
  effect:
    "[When Attacking] If you have [Bunkov], play up to 1 Character card with a cost of 2 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "whenAttacking",
        // Ruling #979 addresses a hypothetical Leader that grants all cards every name --
        // in that case "if you have [Bunkov]" is satisfied without a literal Bunkov on
        // field. That is a property of how "name" filters resolve granted names generically
        // (see cardNames() in shared.ts), not of this card's own encoding, and none of the
        // five Task 2 reference cards grants names, so it is not exercised by a test here.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "character",
            filters: [{ filter: "name", value: "Bunkov" }],
          },
        ],
        actions: [
          {
            action: "play",
            source: {
              player: "self",
              zone: "hand",
            },
            count: {
              amount: 1,
              upTo: true,
            },
            filters: [
              { filter: "cost", comparison: "lte", value: 2 },
              { filter: "cardCategory", value: "character" },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16Antlerkov029I18n,
};
