import type { CharacterCard } from "@tcg/op-types";
import { op15Koala044I18n } from "./044-koala.i18n.ts";

export const op15Koala044: CharacterCard = {
  id: "OP15-044",
  canonicalId: "OP15-044",
  slug: "koala/op15-044",
  name: "Koala",
  printings: [
    {
      id: "OP15-044",
      artId: "OP15-044",
      setCode: "OP15",
      collectorNumber: "044",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-044.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 2000,
  counter: 1000,
  traits: ["Dressrosa", "Revolutionary Army"],
  attribute: "strike",
  effect:
    "[Blocker]\n[On K.O.] Look at 3 cards from the top of your deck; reveal up to 1 [Dressrosa] type Event and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op15Koala044I18n,
};
