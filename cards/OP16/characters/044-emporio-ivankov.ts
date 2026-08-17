import type { CharacterCard } from "@tcg/op-types";
import { op16EmporioIvankov044I18n } from "./044-emporio-ivankov.i18n.ts";

export const op16EmporioIvankov044: CharacterCard = {
  id: "OP16-044",
  canonicalId: "OP16-044",
  slug: "emporio-ivankov/op16-044",
  name: "Emporio.Ivankov",
  printings: [
    {
      id: "OP16-044",
      artId: "OP16-044",
      setCode: "OP16",
      collectorNumber: "044",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-044.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  power: 2000,
  counter: 1000,
  traits: ["Impel Down", "Revolutionary Army"],
  attribute: "special",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)",
  effects: {
    // The parenthetical is the printed reminder text for [Blocker], not a second ability.
    keywords: ["blocker"],
  },
  i18n: op16EmporioIvankov044I18n,
};
