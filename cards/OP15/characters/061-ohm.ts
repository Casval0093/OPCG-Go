import type { CharacterCard } from "@tcg/op-types";
import { op15Ohm061I18n } from "./061-ohm.i18n.ts";

export const op15Ohm061: CharacterCard = {
  id: "OP15-061",
  canonicalId: "OP15-061",
  slug: "ohm/op15-061",
  name: "Ohm",
  printings: [
    {
      id: "OP15-061",
      artId: "OP15-061",
      setCode: "OP15",
      collectorNumber: "061",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-061.png",
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
    "[On Play] DON!! -1: Draw 1 card.\n[When Attacking] If you have 6 or less DON!! cards on your field, give up to 1 of your opponent's Characters -1000 power during this turn.",
  i18n: op15Ohm061I18n,
};
