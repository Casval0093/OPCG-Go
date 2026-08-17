import type { CharacterCard } from "@tcg/op-types";
import { op15Sanji081I18n } from "./081-sanji.i18n.ts";

export const op15Sanji081: CharacterCard = {
  id: "OP15-081",
  canonicalId: "OP15-081",
  slug: "sanji/op15-081",
  name: "Sanji",
  printings: [
    {
      id: "OP15-081",
      artId: "OP15-081",
      setCode: "OP15",
      collectorNumber: "081",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-081.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] If your Leader has the [Straw Hat Crew] type, trash 5 cards from the top of your deck.",
  i18n: op15Sanji081I18n,
};
