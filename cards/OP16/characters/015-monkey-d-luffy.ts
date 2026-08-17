import type { CharacterCard } from "@tcg/op-types";
import { op16MonkeyDLuffy015I18n } from "./015-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy015: CharacterCard = {
  id: "OP16-015",
  canonicalId: "OP16-015",
  slug: "monkey-d-luffy/op16-015",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-015",
      artId: "OP16-015",
      setCode: "OP16",
      collectorNumber: "015",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-015.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If your Leader's card name includes \"Ace\" and you have 6 or more DON!! cards on your field, give this card in your hand -2 cost.\n[On Your Opponent's Attack] You may trash 1 Character card with 8000 power from your hand: Your Leader and this Character's base power becomes 7000 during this turn.",
  i18n: op16MonkeyDLuffy015I18n,
};
