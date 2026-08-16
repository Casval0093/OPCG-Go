import type { CharacterCard } from "@tcg/op-types";
import { op15DrHogback084I18n } from "./084-dr-hogback.i18n.ts";

export const op15DrHogback084: CharacterCard = {
  id: "OP15-084",
  canonicalId: "OP15-084",
  slug: "dr-hogback/op15-084",
  name: "Dr. Hogback",
  printings: [
    {
      id: "OP15-084",
      artId: "OP15-084",
      setCode: "OP15",
      collectorNumber: "084",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-084.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Thriller Bark Pirates"],
  attribute: "wisdom",
  effect:
    "[On Play] If your Leader has the [Thriller Bark Pirates] type, trash 5 cards from the top of your deck.\n[On K.O.] If you have 6 or less cards in your hand, draw 1 card.",
  i18n: op15DrHogback084I18n,
};
