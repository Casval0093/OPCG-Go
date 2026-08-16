import type { CharacterCard } from "@tcg/op-types";
import { op16MonkeyDLuffy095I18n } from "./095-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy095: CharacterCard = {
  id: "OP16-095",
  canonicalId: "OP16-095",
  slug: "monkey-d-luffy/op16-095",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-095",
      artId: "OP16-095",
      setCode: "OP16",
      collectorNumber: "095",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-095.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 2,
  power: 2000,
  counter: 2000,
  traits: ["Land of Wano", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] Up to 1 of your black [Land of Wano] type Characters gains [Unblockable] during this turn.\n(This card cannot be blocked.)",
  i18n: op16MonkeyDLuffy095I18n,
};
