import type { CharacterCard } from "@tcg/op-types";
import { op15JewelryBonney105I18n } from "./105-jewelry-bonney.i18n.ts";

export const op15JewelryBonney105: CharacterCard = {
  id: "OP15-105",
  canonicalId: "OP15-105",
  slug: "jewelry-bonney/op15-105",
  name: "Jewelry Bonney",
  printings: [
    {
      id: "OP15-105",
      artId: "OP15-105",
      setCode: "OP15",
      collectorNumber: "105",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-105.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Supernovas", "Bonney Pirates"],
  attribute: "special",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may add 1 card from the top of your Life cards to your hand instead.",
  i18n: op15JewelryBonney105I18n,
};
