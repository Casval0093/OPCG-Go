import type { CharacterCard } from "@tcg/op-types";
import { op15Cavendish006I18n } from "./006-cavendish.i18n.ts";

export const op15Cavendish006: CharacterCard = {
  id: "OP15-006",
  canonicalId: "OP15-006",
  slug: "cavendish/op15-006",
  name: "Cavendish",
  printings: [
    {
      id: "OP15-006",
      artId: "OP15-006",
      setCode: "OP15",
      collectorNumber: "006",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-006.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 2000,
  traits: ["Dressrosa", "Beautiful Pirates"],
  attribute: "slash",
  effect: "If you have 4 or more Events in your trash, this Character gains +2000 power.",
  i18n: op15Cavendish006I18n,
};
