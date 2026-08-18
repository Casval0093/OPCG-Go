import type { CharacterCard } from "@tcg/op-types";
import { op16GeckoMoria105I18n } from "./105-gecko-moria.i18n.ts";

export const op16GeckoMoria105: CharacterCard = {
  id: "OP16-105",
  canonicalId: "OP16-105",
  slug: "gecko-moria/op16-105",
  name: "Gecko Moria",
  printings: [
    {
      id: "OP16-105",
      artId: "OP16-105",
      setCode: "OP16",
      collectorNumber: "105",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-105.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 6,
  power: 7000,
  counter: 1000,
  trigger:
    "If you have 1 or less Life cards, play up to 1 [Absalom], up to 1 [Dr. Hogback], and up to 1 [Perona], with a cost of 4 or less from your trash.",
  traits: ["The Seven Warlords of the Sea", "Thriller Bark Pirates"],
  attribute: "special",
  effects: {
    effects: [
      {
        trigger: "trigger",
        conditions: [
          {
            // The printed number, not printed-minus-one. A [Trigger] resolves after its own card
            // has left the Life area, so this card does not count itself -- ruling #1013 settles
            // the identical shape on OP16-111 (3 Life including the card satisfies "2 or less").
            condition: "lifeCount",
            player: "self",
            comparison: "lte",
            value: 1,
          },
        ],
        // Three independent "up to 1" selections, not a `playGrouped`: nothing here says the
        // extra bodies arrive rested, which is the only thing `playGrouped`'s mandatory
        // `playStates` is for. "with a cost of 4 or less" trails the whole list and binds to all
        // three names, so each action carries its own copy of the cost filter.
        actions: [
          {
            action: "play",
            source: {
              player: "self",
              zone: "trash",
            },
            count: {
              amount: 1,
              upTo: true,
            },
            filters: [
              {
                filter: "name",
                value: "Absalom",
              },
              {
                filter: "cost",
                comparison: "lte",
                value: 4,
              },
            ],
          },
          {
            action: "play",
            source: {
              player: "self",
              zone: "trash",
            },
            count: {
              amount: 1,
              upTo: true,
            },
            filters: [
              {
                filter: "name",
                value: "Dr. Hogback",
              },
              {
                filter: "cost",
                comparison: "lte",
                value: 4,
              },
            ],
          },
          {
            action: "play",
            source: {
              player: "self",
              zone: "trash",
            },
            count: {
              amount: 1,
              upTo: true,
            },
            filters: [
              {
                filter: "name",
                value: "Perona",
              },
              {
                filter: "cost",
                comparison: "lte",
                value: 4,
              },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16GeckoMoria105I18n,
};
