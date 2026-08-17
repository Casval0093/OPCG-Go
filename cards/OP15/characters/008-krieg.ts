import type { CharacterCard } from "@tcg/op-types";
import { op15Krieg008I18n } from "./008-krieg.i18n.ts";

export const op15Krieg008: CharacterCard = {
  id: "OP15-008",
  canonicalId: "OP15-008",
  slug: "krieg/op15-008",
  name: "Krieg",
  printings: [
    {
      id: "OP15-008",
      artId: "OP15-008",
      setCode: "OP15",
      collectorNumber: "008",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-008.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP15",
  cost: 8,
  power: 9000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Give up to 3 of your opponent's rested DON!! cards to 1 of your opponent's Characters. Then, this Character gains [Rush] during this turn.\n[Activate: Main] [Once Per Turn] If this Character was played on this turn, give all of your opponent's Characters -1000 power during this turn for every DON!! card given to that Character.",
  i18n: op15Krieg008I18n,
};
