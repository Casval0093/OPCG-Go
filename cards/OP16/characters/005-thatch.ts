import type { CharacterCard } from "@tcg/op-types";
import { op16Thatch005I18n } from "./005-thatch.i18n.ts";

export const op16Thatch005: CharacterCard = {
  id: "OP16-005",
  canonicalId: "OP16-005",
  slug: "thatch/op16-005",
  name: "Thatch",
  printings: [
    {
      id: "OP16-005",
      artId: "OP16-005",
      setCode: "OP16",
      collectorNumber: "005",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-005.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP16",
  cost: 8,
  power: 8000,
  counter: 1000,
  traits: ["Whitebeard Pirates"],
  attribute: "slash",
  effect:
    'If you have a Character with 8000 power or more and a type including "Whitebeard Pirates", give this card in your hand -3 cost.\n[Blocker]',
  i18n: op16Thatch005I18n,
};
