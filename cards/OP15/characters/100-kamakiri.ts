import type { CharacterCard } from "@tcg/op-types";
import { op15Kamakiri100I18n } from "./100-kamakiri.i18n.ts";

export const op15Kamakiri100: CharacterCard = {
  id: "OP15-100",
  canonicalId: "OP15-100",
  slug: "kamakiri/op15-100",
  name: "Kamakiri",
  printings: [
    {
      id: "OP15-100",
      artId: "OP15-100",
      setCode: "OP15",
      collectorNumber: "100",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-100.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "slash",
  effect:
    "[On Play] You may trash this Character and add 1 card from the top of your Life cards to your hand: K.O. up to 1 of your opponent's Characters with a cost of 6 or less.",
  i18n: op15Kamakiri100I18n,
};
