import type { CharacterCard } from "@tcg/op-types";
import { op15Hajrudin049I18n } from "./049-hajrudin.i18n.ts";

export const op15Hajrudin049: CharacterCard = {
  id: "OP15-049",
  canonicalId: "OP15-049",
  slug: "hajrudin/op15-049",
  name: "Hajrudin",
  printings: [
    {
      id: "OP15-049",
      artId: "OP15-049",
      setCode: "OP15",
      collectorNumber: "049",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-049.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 2000,
  traits: ["Giant", "Dressrosa", "New Giant Pirates"],
  attribute: "strike",
  i18n: op15Hajrudin049I18n,
};
