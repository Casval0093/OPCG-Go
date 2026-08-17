import type { CharacterCard } from "@tcg/op-types";
import { op15Ryuma036I18n } from "./036-ryuma.i18n.ts";

export const op15Ryuma036: CharacterCard = {
  id: "OP15-036",
  canonicalId: "OP15-036",
  slug: "ryuma/op15-036",
  name: "Ryuma",
  printings: [
    {
      id: "OP15-036",
      artId: "OP15-036",
      setCode: "OP15",
      collectorNumber: "036",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-036.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 6,
  power: 8000,
  traits: ["Land of Wano", "Thriller Bark Pirates"],
  attribute: "slash",
  effect:
    "[On Play]/[When Attacking] K.O. up to 1 of your opponent's rested Characters with a cost of 4 or less.",
  i18n: op15Ryuma036I18n,
};
