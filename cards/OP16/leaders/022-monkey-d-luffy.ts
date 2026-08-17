import type { LeaderCard } from "@tcg/op-types";
import { op16MonkeyDLuffy022I18n } from "./022-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy022: LeaderCard = {
  id: "OP16-022",
  canonicalId: "OP16-022",
  slug: "monkey-d-luffy/op16-022",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-022",
      artId: "OP16-022",
      setCode: "OP16",
      collectorNumber: "022",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-022.png",
    },
  ],
  cardType: "leader",
  color: ["green", "blue"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 4,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[Activate: Main] [Once Per Turn] If the only Characters on your field are [Impel Down] type Characters, set up to 2 of your DON!! cards as active.",
  i18n: op16MonkeyDLuffy022I18n,
};
