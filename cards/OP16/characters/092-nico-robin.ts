import type { CharacterCard } from "@tcg/op-types";
import { op16NicoRobin092I18n } from "./092-nico-robin.i18n.ts";

export const op16NicoRobin092: CharacterCard = {
  id: "OP16-092",
  canonicalId: "OP16-092",
  slug: "nico-robin/op16-092",
  name: "Nico Robin",
  printings: [
    {
      id: "OP16-092",
      artId: "OP16-092",
      setCode: "OP16",
      collectorNumber: "092",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-092.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Land of Wano", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] You may trash 1 Character card with a cost of 8 or more from your hand: Draw 2 cards.",
  i18n: op16NicoRobin092I18n,
};
