import type { CharacterCard } from "@tcg/op-types";
import { op15Wyper114I18n } from "./114-wyper.i18n.ts";

export const op15Wyper114: CharacterCard = {
  id: "OP15-114",
  canonicalId: "OP15-114",
  slug: "wyper/op15-114",
  name: "Wyper",
  printings: [
    {
      id: "OP15-114",
      artId: "OP15-114",
      setCode: "OP15",
      collectorNumber: "114",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-114.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SR",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "ranged",
  effect:
    "[On Play] You may turn 1 card from the top of your Life cards face-up: Give all of your opponent's Characters -2000 power during this turn. Then, K.O. all of your opponent's Characters with 0 power or less.\n[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to 1 of your [Sky Island] type Leader or Character cards.",
  i18n: op15Wyper114I18n,
};
