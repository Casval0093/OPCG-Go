import type { CharacterCard } from "@tcg/op-types";
import { op16LittleoarsJr017I18n } from "./017-littleoars-jr.i18n.ts";

export const op16LittleoarsJr017: CharacterCard = {
  id: "OP16-017",
  canonicalId: "OP16-017",
  slug: "littleoars-jr/op16-017",
  name: "LittleOars Jr.",
  printings: [
    {
      id: "OP16-017",
      artId: "OP16-017",
      setCode: "OP16",
      collectorNumber: "017",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-017.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 4,
  power: 8000,
  counter: 1000,
  traits: ["Giant", "Whitebeard Pirates Allies"],
  attribute: "strike",
  effect:
    'If you have no Characters with a type including "Whitebeard Pirates" and a cost of 8 or more, give this Character -4000 power.\n[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)',
  effects: {
    keywords: ["blocker"],
    permanentEffects: [
      {
        // Both qualities on the SAME Character: a cost-8 body without the type, or a Whitebeard
        // body under cost 8, leaves the debuff in place.
        conditions: [
          {
            condition: "notHasCard",
            player: "self",
            zone: "character",
            filters: [
              { filter: "trait", value: ["Whitebeard Pirates", "Former Whitebeard Pirates", "Whitebeard Pirates Allies"], match: "includes" },
              { filter: "cost", comparison: "gte", value: 8 },
            ],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: -4000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op16LittleoarsJr017I18n,
};
