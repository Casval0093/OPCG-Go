import type { CharacterCard } from "@tcg/op-types";
import { op16Sakazuki065I18n } from "./065-sakazuki.i18n.ts";

export const op16Sakazuki065: CharacterCard = {
  id: "OP16-065",
  canonicalId: "OP16-065",
  slug: "sakazuki/op16-065",
  name: "Sakazuki",
  printings: [
    {
      id: "OP16-065",
      artId: "OP16-065",
      setCode: "OP16",
      collectorNumber: "065",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-065.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SR",
  setId: "OP16",
  cost: 7,
  power: 8000,
  traits: ["Admiral", "Navy"],
  attribute: "special",
  effect:
    "[On Play] DON!! -1: Give up to 1 of your opponent's Characters -6000 power until the end of your opponent's next End Phase.\n[Activate: Main] [Once Per Turn] You may rest 1 of your DON!! cards: If your Leader has the [Navy] type, add up to 2 DON!! cards from your DON!! deck and set them as active.",
  i18n: op16Sakazuki065I18n,
};
