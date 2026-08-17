import type { CharacterCard } from "@tcg/op-types";
import { op15MonkeyDLuffy092I18n } from "./092-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy092: CharacterCard = {
  id: "OP15-092",
  canonicalId: "OP15-092",
  slug: "monkey-d-luffy/op15-092",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-092",
      artId: "OP15-092",
      setCode: "OP15",
      collectorNumber: "092",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-092.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "special",
  effect:
    "Apply each of the following effects based on the number of cards in your trash:\n• If there are 10 or more cards, this Character's base power becomes 9000 and it gains +10 cost.\n• If you have 20 or more cards, during your opponent's turn, your Leader's base power becomes 7000.\n• If you have 30 or more cards, this Character gains +1000 power.",
  i18n: op15MonkeyDLuffy092I18n,
};
