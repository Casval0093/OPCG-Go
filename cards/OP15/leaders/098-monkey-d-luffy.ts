import type { LeaderCard } from "@tcg/op-types";
import { op15MonkeyDLuffy098I18n } from "./098-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy098: LeaderCard = {
  id: "OP15-098",
  canonicalId: "OP15-098",
  slug: "monkey-d-luffy/op15-098",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-098",
      artId: "OP15-098",
      setCode: "OP15",
      collectorNumber: "098",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-098.png",
    },
  ],
  cardType: "leader",
  color: ["yellow"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 5,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If your [Sky Island] type Character with 6000 base power or more would be removed from the field by your opponent, you may add 1 card from the top of your Life cards to your hand instead.",
  i18n: op15MonkeyDLuffy098I18n,
};
