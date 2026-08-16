import type { CharacterCard } from "@tcg/op-types";
import { op16EdwardNewgate003I18n } from "./003-edward-newgate.i18n.ts";

export const op16EdwardNewgate003: CharacterCard = {
  id: "OP16-003",
  canonicalId: "OP16-003",
  slug: "edward-newgate/op16-003",
  name: "Edward.Newgate",
  printings: [
    {
      id: "OP16-003",
      artId: "OP16-003",
      setCode: "OP16",
      collectorNumber: "003",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-003.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP16",
  cost: 8,
  power: 10000,
  traits: ["The Four Emperors", "Whitebeard Pirates"],
  attribute: "special",
  effect:
    "[Your Turn] Your Leader gains [Double Attack] and +2000 power.\n[On Play] You may reveal 2 Character cards with 8000 power from your hand: Give up to 1 of your opponent's Characters -6000 power during this turn.",
  i18n: op16EdwardNewgate003I18n,
};
