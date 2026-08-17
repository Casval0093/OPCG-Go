import type { CharacterCard } from "@tcg/op-types";
import { op16Kuzan063I18n } from "./063-kuzan.i18n.ts";

export const op16Kuzan063: CharacterCard = {
  id: "OP16-063",
  canonicalId: "OP16-063",
  slug: "kuzan/op16-063",
  name: "Kuzan",
  printings: [
    {
      id: "OP16-063",
      artId: "OP16-063",
      setCode: "OP16",
      collectorNumber: "063",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-063.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP16",
  cost: 7,
  power: 8000,
  traits: ["Admiral", "Navy"],
  attribute: "special",
  effect:
    "[On Play] Add up to 2 DON!! cards from your DON!! deck and rest them.\n[Activate: Main] [Once Per Turn] DON!! -1: Up to 1 of your opponent's Characters cannot activate [Blocker] during this turn.",
  i18n: op16Kuzan063I18n,
};
