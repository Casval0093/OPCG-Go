import type { CharacterCard } from "@tcg/op-types";
import { op15MonkeyDLuffy051I18n } from "./051-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy051: CharacterCard = {
  id: "OP15-051",
  canonicalId: "OP15-051",
  slug: "monkey-d-luffy/op15-051",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-051",
      artId: "OP15-051",
      setCode: "OP15",
      collectorNumber: "051",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-051.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 2000,
  traits: ["Dressrosa", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[Opponent's Turn] If your Leader has the [Dressrosa] type, this Character gains +3000 power.",
  i18n: op15MonkeyDLuffy051I18n,
};
