import type { CharacterCard } from "@tcg/op-types";
import { op15Perona090I18n } from "./090-perona.i18n.ts";

export const op15Perona090: CharacterCard = {
  id: "OP15-090",
  canonicalId: "OP15-090",
  slug: "perona/op15-090",
  name: "Perona",
  printings: [
    {
      id: "OP15-090",
      artId: "OP15-090",
      setCode: "OP15",
      collectorNumber: "090",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-090.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Thriller Bark Pirates"],
  attribute: "special",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may trash 1 card from your hand instead.",
  i18n: op15Perona090I18n,
};
