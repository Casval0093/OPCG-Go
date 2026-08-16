import type { CharacterCard } from "@tcg/op-types";
import { op15HodyJones033I18n } from "./033-hody-jones.i18n.ts";

export const op15HodyJones033: CharacterCard = {
  id: "OP15-033",
  canonicalId: "OP15-033",
  slug: "hody-jones/op15-033",
  name: "Hody Jones",
  printings: [
    {
      id: "OP15-033",
      artId: "OP15-033",
      setCode: "OP15",
      collectorNumber: "033",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-033.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Fish-Man", "Fish-Man Island", "New Fish-Man Pirates"],
  attribute: "strike",
  effect:
    "[On Play] Set your [Fish-Man] type Leader as active. Then, add 1 card from the top of your Life cards to your hand.",
  i18n: op15HodyJones033I18n,
};
