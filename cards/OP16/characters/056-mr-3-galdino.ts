import type { CharacterCard } from "@tcg/op-types";
import { op16Mr3Galdino056I18n } from "./056-mr-3-galdino.i18n.ts";

export const op16Mr3Galdino056: CharacterCard = {
  id: "OP16-056",
  canonicalId: "OP16-056",
  slug: "mr-3-galdino/op16-056",
  name: "Mr.3(Galdino)",
  printings: [
    {
      id: "OP16-056",
      artId: "OP16-056",
      setCode: "OP16",
      collectorNumber: "056",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-056.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[Activate: Main] You may trash this Character: Draw 2 cards, and up to 1 of your opponent's Characters with a cost of 9 or less cannot attack until the end of your opponent's next End Phase.",
  i18n: op16Mr3Galdino056I18n,
};
