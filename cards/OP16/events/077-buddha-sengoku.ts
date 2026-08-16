import type { EventCard } from "@tcg/op-types";
import { op16BuddhaSengoku077I18n } from "./077-buddha-sengoku.i18n.ts";

export const op16BuddhaSengoku077: EventCard = {
  id: "OP16-077",
  canonicalId: "OP16-077",
  slug: "buddha-sengoku/op16-077",
  name: '"Buddha" Sengoku',
  printings: [
    {
      id: "OP16-077",
      artId: "OP16-077",
      setCode: "OP16",
      collectorNumber: "077",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-077.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  traits: ["Navy"],
  effect:
    "[Main] Look at 5 cards from the top of your deck; reveal up to 2 [Navy] type cards, add them to your hand and place the rest at the bottom of your deck in any order. Then, trash 1 card from your hand.",
  i18n: op16BuddhaSengoku077I18n,
};
