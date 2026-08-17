import type { CharacterCard } from "@tcg/op-types";
import { op15Oars080I18n } from "./080-oars.i18n.ts";

export const op15Oars080: CharacterCard = {
  id: "OP15-080",
  canonicalId: "OP15-080",
  slug: "oars/op15-080",
  name: "Oars",
  printings: [
    {
      id: "OP15-080",
      artId: "OP15-080",
      setCode: "OP15",
      collectorNumber: "080",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-080.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 0,
  counter: 1000,
  traits: ["Giant", "Thriller Bark Pirates"],
  attribute: "strike",
  effect:
    "If you have [Gecko Moria] with 10000 power or more on your field and there are no other [Oars] cards, this Character gains +7000 power.\n[On K.O.] You may place 3 cards from your trash at the bottom of your deck in any order: Play this Character card from your trash.",
  i18n: op15Oars080I18n,
};
