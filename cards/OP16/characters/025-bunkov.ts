import type { CharacterCard } from "@tcg/op-types";
import { op16Bunkov025I18n } from "./025-bunkov.i18n.ts";

export const op16Bunkov025: CharacterCard = {
  id: "OP16-025",
  canonicalId: "OP16-025",
  slug: "bunkov/op16-025",
  name: "Bunkov",
  printings: [
    {
      id: "OP16-025",
      artId: "OP16-025",
      setCode: "OP16",
      collectorNumber: "025",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-025.png",
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
  attribute: "strike",
  effect:
    "[When Attacking] If you have [Antlerkov], play up to 1 Character card with a cost of 2 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "whenAttacking",
        // Ruling #977 is the exact mirror of OP16-029 Antlerkov's #979, on the card Antlerkov
        // names: a Leader whose own effect grants it every card's name/trait/attribute satisfies
        // "if you have [Antlerkov]" by itself, with zero Antlerkov Characters on the field
        // (可以). So "if you have [Name]" scans the whole field, Leader included --
        // `zone: "character"` structurally excludes the Leader and makes the ruling's answer
        // unencodable. `player: "self"` is the other half of the SC text, which is explicit
        // about the owner: 我方场上存在“角科夫”的场合. See cards/tests/OP16/025-bunkov.test.ts.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "field",
            filters: [{ filter: "name", value: "Antlerkov" }],
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
  i18n: op16Bunkov025I18n,
};
