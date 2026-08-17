import type { CharacterCard } from "@tcg/op-types";
import { op16MonkeyDLuffy034I18n } from "./034-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy034: CharacterCard = {
  id: "OP16-034",
  canonicalId: "OP16-034",
  slug: "monkey-d-luffy/op16-034",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-034",
      artId: "OP16-034",
      setCode: "OP16",
      collectorNumber: "034",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-034.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[DON!! x1] [Your Turn] This Character gains +1000 power for each of your Characters with a different card name.\n[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Impel Down] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op16MonkeyDLuffy034I18n,
};
