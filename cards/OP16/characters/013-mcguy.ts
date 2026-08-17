import type { CharacterCard } from "@tcg/op-types";
import { op16Mcguy013I18n } from "./013-mcguy.i18n.ts";

export const op16Mcguy013: CharacterCard = {
  id: "OP16-013",
  canonicalId: "OP16-013",
  slug: "mcguy/op16-013",
  name: "McGuy",
  printings: [
    {
      id: "OP16-013",
      artId: "OP16-013",
      setCode: "OP16",
      collectorNumber: "013",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-013.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP16",
  cost: 6,
  power: 8000,
  traits: ["Whitebeard Pirates Allies"],
  attribute: "slash",
  effect: "[On K.O.] K.O. up to 1 of your opponent's Characters with 8000 base power or less.",
  i18n: op16Mcguy013I18n,
};
