import type { CharacterCard } from "@tcg/op-types";
import { op16TrafalgarLaw030I18n } from "./030-trafalgar-law.i18n.ts";

export const op16TrafalgarLaw030: CharacterCard = {
  id: "OP16-030",
  canonicalId: "OP16-030",
  slug: "trafalgar-law/op16-030",
  name: "Trafalgar Law",
  printings: [
    {
      id: "OP16-030",
      artId: "OP16-030",
      setCode: "OP16",
      collectorNumber: "030",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-030.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  power: 9000,
  traits: ["Supernovas", "Heart Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Up to 1 of your opponent's rested Characters will not become active in your opponent's next Refresh Phase.\n[End of Your Turn] Set all of your green Characters with a cost of 5 or less as active.",
  i18n: op16TrafalgarLaw030I18n,
};
