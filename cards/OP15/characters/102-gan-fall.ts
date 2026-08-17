import type { CharacterCard } from "@tcg/op-types";
import { op15GanFall102I18n } from "./102-gan-fall.i18n.ts";

export const op15GanFall102: CharacterCard = {
  id: "OP15-102",
  canonicalId: "OP15-102",
  slug: "gan-fall/op15-102",
  name: "Gan.Fall",
  printings: [
    {
      id: "OP15-102",
      artId: "OP15-102",
      setCode: "OP15",
      collectorNumber: "102",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-102.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 2000,
  traits: ["Sky Island"],
  attribute: "slash",
  effect:
    "If you have a [Sky Island] type Character with 7000 power or more, give this card in your hand -3 cost.\n[On Play] Rest up to 1 of your opponent's Characters with a cost equal to or less than the number of your opponent's Life cards.",
  i18n: op15GanFall102I18n,
};
