import type { CharacterCard } from "@tcg/op-types";
import { op15Shura067I18n } from "./067-shura.i18n.ts";

export const op15Shura067: CharacterCard = {
  id: "OP15-067",
  canonicalId: "OP15-067",
  slug: "shura/op15-067",
  name: "Shura",
  printings: [
    {
      id: "OP15-067",
      artId: "OP15-067",
      setCode: "OP15",
      collectorNumber: "067",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-067.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Sky Island", "Vassals"],
  attribute: "slash",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character gains [Rush].\n(This card can attack on the turn in which it is played.)\n[On Play] DON!! -1: Draw 1 card.",
  i18n: op15Shura067I18n,
};
