import type { CharacterCard } from "@tcg/op-types";
import { op16Shanks006I18n } from "./006-shanks.i18n.ts";

export const op16Shanks006: CharacterCard = {
  id: "OP16-006",
  canonicalId: "OP16-006",
  slug: "shanks/op16-006",
  name: "Shanks",
  printings: [
    {
      id: "OP16-006",
      artId: "OP16-006",
      setCode: "OP16",
      collectorNumber: "006",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-006.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 2000,
  traits: ["The Four Emperors", "Red-Haired Pirates"],
  attribute: "slash",
  effect:
    "[On Play] You may rest 2 of your DON!! cards: K.O. up to 1 of your opponent's Characters with 4000 power or less.",
  i18n: op16Shanks006I18n,
};
