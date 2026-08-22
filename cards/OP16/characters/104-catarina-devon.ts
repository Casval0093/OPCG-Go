import type { CharacterCard } from "@tcg/op-types";
import { op16CatarinaDevon104I18n } from "./104-catarina-devon.i18n.ts";

export const op16CatarinaDevon104: CharacterCard = {
  id: "OP16-104",
  canonicalId: "OP16-104",
  slug: "catarina-devon/op16-104",
  name: "Catarina Devon",
  printings: [
    {
      id: "OP16-104",
      artId: "OP16-104",
      setCode: "OP16",
      collectorNumber: "104",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-104.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 4,
  power: 3000,
  counter: 2000,
  trigger:
    "Draw 1 card and play up to 1 [Blackbeard Pirates] type Character with a cost of 1 from your trash.",
  traits: ["Impel Down", "Blackbeard Pirates"],
  attribute: "special",
  effect:
    "[When Attacking] Select up to 1 of your opponent's Characters. This Character's base power becomes the same as the selected Character's power during this turn.",
  effects: {
    effects: [
      {
        trigger: "whenAttacking",
        actions: [
          {
            // "This Character's base power becomes the same as the selected Character's power":
            // `copyPower` always retargets the card bearing the effect and stores a
            // `type: "setBasePower"` replacement of `getCardPower(source)`, which is exactly a
            // base-power replacement, and it reads the SOURCE's current power, not its printed
            // base power. The `target` here is therefore the card being COPIED FROM, not the
            // card being changed.
            action: "copyPower",
            target: {
              player: "opponent",
              zones: ["character"],
              count: {
                amount: 1,
                upTo: true,
              },
            },
            duration: "thisTurn",
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "draw",
            player: "self",
            amount: 1,
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
                filter: "trait",
                value: "Blackbeard Pirates",
                match: "includes",
              },
              {
                // "with a cost of 1" -- a bare number is an equality, not "1 or less"
                // (rulings #962/#963).
                filter: "cost",
                comparison: "eq",
                value: 1,
              },
              {
                filter: "cardCategory",
                value: "character",
              },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16CatarinaDevon104I18n,
};
