import type { CharacterCard } from "@tcg/op-types";
import { op16Marco014I18n } from "./014-marco.i18n.ts";

export const op16Marco014: CharacterCard = {
  id: "OP16-014",
  canonicalId: "OP16-014",
  slug: "marco/op16-014",
  name: "Marco",
  printings: [
    {
      id: "OP16-014",
      artId: "OP16-014",
      setCode: "OP16",
      collectorNumber: "014",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-014.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 6,
  power: 8000,
  traits: ["Whitebeard Pirates"],
  attribute: "special",
  effect:
    "If one of your Characters would be removed from the field by your opponent's effect, you may K.O. this Character instead.\n[On K.O.] You may trash 1 Character card with 8000 power from your hand: Play this Character card from your trash.",
  i18n: op16Marco014I18n,
};
