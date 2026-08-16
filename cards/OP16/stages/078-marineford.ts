import type { StageCard } from "@tcg/op-types";
import { op16Marineford078I18n } from "./078-marineford.i18n.ts";

export const op16Marineford078: StageCard = {
  id: "OP16-078",
  canonicalId: "OP16-078",
  slug: "marineford/op16-078",
  name: "Marineford",
  printings: [
    {
      id: "OP16-078",
      artId: "OP16-078",
      setCode: "OP16",
      collectorNumber: "078",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-078.png",
    },
  ],
  cardType: "stage",
  color: ["purple"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  traits: ["Navy"],
  effect:
    "[On Play] Look at 5 cards from the top of your deck; reveal up to 1 [Navy] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.\n[Activate: Main] DON!! -1, You may rest this Stage: Draw 1 card and trash 1 card from your hand.",
  i18n: op16Marineford078I18n,
};
