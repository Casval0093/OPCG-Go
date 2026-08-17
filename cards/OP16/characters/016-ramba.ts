import type { CharacterCard } from "@tcg/op-types";
import { op16Ramba016I18n } from "./016-ramba.i18n.ts";

export const op16Ramba016: CharacterCard = {
  id: "OP16-016",
  canonicalId: "OP16-016",
  slug: "ramba/op16-016",
  name: "Ramba",
  printings: [
    {
      id: "OP16-016",
      artId: "OP16-016",
      setCode: "OP16",
      collectorNumber: "016",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-016.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP16",
  cost: 6,
  power: 8000,
  counter: 1000,
  traits: ["Whitebeard Pirates Allies"],
  attribute: "slash",
  i18n: op16Ramba016I18n,
};
