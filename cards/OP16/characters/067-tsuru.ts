import type { CharacterCard } from "@tcg/op-types";
import { op16Tsuru067I18n } from "./067-tsuru.i18n.ts";

export const op16Tsuru067: CharacterCard = {
  id: "OP16-067",
  canonicalId: "OP16-067",
  slug: "tsuru/op16-067",
  name: "Tsuru",
  printings: [
    {
      id: "OP16-067",
      artId: "OP16-067",
      setCode: "OP16",
      collectorNumber: "067",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-067.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Navy"],
  attribute: "wisdom",
  effect:
    "[On Play] Look at 5 cards from the top of your deck; reveal up to 1 [Navy] type card, add it to your hand and place the rest at the bottom of your deck in any order. Then, trash 1 card from your hand.",
  i18n: op16Tsuru067I18n,
};
