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
  i18n: op16GeckoMoria105I18n,
};
