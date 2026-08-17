import type { CharacterCard } from "@tcg/op-types";
import { op15Conis104I18n } from "./104-conis.i18n.ts";

export const op15Conis104: CharacterCard = {
  id: "OP15-104",
  canonicalId: "OP15-104",
  slug: "conis/op15-104",
  name: "Conis",
  printings: [
    {
      id: "OP15-104",
      artId: "OP15-104",
      setCode: "OP15",
      collectorNumber: "104",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-104.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 2000,
  trigger: "Draw 2 cards and trash 1 card from your hand.",
  traits: ["Sky Island"],
  attribute: "wisdom",
  effect:
    "[On Play] If you have less Life cards than your opponent, draw 2 cards and trash 2 cards from your hand.",
  i18n: op15Conis104I18n,
};
