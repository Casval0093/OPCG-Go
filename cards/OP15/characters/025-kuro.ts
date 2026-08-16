import type { CharacterCard } from "@tcg/op-types";
import { op15Kuro025I18n } from "./025-kuro.i18n.ts";

export const op15Kuro025: CharacterCard = {
  id: "OP15-025",
  canonicalId: "OP15-025",
  slug: "kuro/op15-025",
  name: "Kuro",
  printings: [
    {
      id: "OP15-025",
      artId: "OP15-025",
      setCode: "OP15",
      collectorNumber: "025",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-025.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["East Blue", "Black Cat Pirates"],
  attribute: "slash",
  effect:
    "[Blocker]\n[On Play] Give up to 2 DON!! cards from your opponent's cost area to 1 of your opponent's Characters. Then, at the end of this turn, up to 1 rested Character with 3 or more DON!! cards given will not become active in your opponent's next Refresh Phase.",
  i18n: op15Kuro025I18n,
};
