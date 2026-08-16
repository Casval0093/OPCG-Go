import type { CharacterCard } from "@tcg/op-types";
import { op16Sengoku066I18n } from "./066-sengoku.i18n.ts";

export const op16Sengoku066: CharacterCard = {
  id: "OP16-066",
  canonicalId: "OP16-066",
  slug: "sengoku/op16-066",
  name: "Sengoku",
  printings: [
    {
      id: "OP16-066",
      artId: "OP16-066",
      setCode: "OP16",
      collectorNumber: "066",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-066.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "UC",
  setId: "OP16",
  cost: 5,
  power: 5000,
  counter: 2000,
  traits: ["Navy"],
  attribute: "wisdom",
  effect:
    "[On Play] If your Leader has the [Navy] type, add up to 2 DON!! cards from your DON!! deck and rest them. Then, draw 2 cards and trash 2 cards from your hand.",
  i18n: op16Sengoku066I18n,
};
