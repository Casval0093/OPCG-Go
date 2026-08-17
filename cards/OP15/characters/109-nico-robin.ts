import type { CharacterCard } from "@tcg/op-types";
import { op15NicoRobin109I18n } from "./109-nico-robin.i18n.ts";

export const op15NicoRobin109: CharacterCard = {
  id: "OP15-109",
  canonicalId: "OP15-109",
  slug: "nico-robin/op15-109",
  name: "Nico Robin",
  printings: [
    {
      id: "OP15-109",
      artId: "OP15-109",
      setCode: "OP15",
      collectorNumber: "109",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-109.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] You may add 1 card from the top of your Life cards to your hand: If your Leader has the [Straw Hat Crew] type, add up to 1 card from the top of your deck to the top of your Life cards. Then, play up to 1 [Sky Island] type Character card with a cost of 5 or less from your hand.",
  i18n: op15NicoRobin109I18n,
};
