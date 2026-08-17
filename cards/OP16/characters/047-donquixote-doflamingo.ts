import type { CharacterCard } from "@tcg/op-types";
import { op16DonquixoteDoflamingo047I18n } from "./047-donquixote-doflamingo.i18n.ts";

export const op16DonquixoteDoflamingo047: CharacterCard = {
  id: "OP16-047",
  canonicalId: "OP16-047",
  slug: "donquixote-doflamingo/op16-047",
  name: "Donquixote Doflamingo",
  printings: [
    {
      id: "OP16-047",
      artId: "OP16-047",
      setCode: "OP16",
      collectorNumber: "047",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-047.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 0,
  counter: 1000,
  traits: ["Impel Down", "Donquixote Pirates"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: If your opponent has 8 or more cards in their hand, they place 2 cards from their hand at the bottom of their deck in any order.",
  i18n: op16DonquixoteDoflamingo047I18n,
};
