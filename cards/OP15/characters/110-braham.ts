import type { CharacterCard } from "@tcg/op-types";
import { op15Braham110I18n } from "./110-braham.i18n.ts";

export const op15Braham110: CharacterCard = {
  id: "OP15-110",
  canonicalId: "OP15-110",
  slug: "braham/op15-110",
  name: "Braham",
  printings: [
    {
      id: "OP15-110",
      artId: "OP15-110",
      setCode: "OP15",
      collectorNumber: "110",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-110.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 2000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "ranged",
  effect:
    "[On K.O.] If your Leader has the [Shandian Warrior] type, add up to 1 card from the top of your deck to the top of your Life cards.",
  i18n: op15Braham110I18n,
};
