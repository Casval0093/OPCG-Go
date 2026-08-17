import type { CharacterCard } from "@tcg/op-types";
import { op15Enel118I18n } from "./118-enel.i18n.ts";

export const op15Enel118: CharacterCard = {
  id: "OP15-118",
  canonicalId: "OP15-118",
  slug: "enel/op15-118",
  name: "Enel",
  printings: [
    {
      id: "OP15-118",
      artId: "OP15-118",
      setCode: "OP15",
      collectorNumber: "118",
      rarity: "SEC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-118.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SEC",
  setId: "OP15",
  cost: 6,
  power: 8000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character cannot be removed from the field by your opponent's effects and gains +2000 power.\n[On Play] DON!! -1: Look at 5 cards from the top of your deck and add up to 1 card to your hand. Then, place the rest at the bottom of your deck in any order, and trash 1 card from your hand.",
  i18n: op15Enel118I18n,
};
