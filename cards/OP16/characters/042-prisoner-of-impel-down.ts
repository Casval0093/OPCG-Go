import type { CharacterCard } from "@tcg/op-types";
import { op16PrisonerOfImpelDown042I18n } from "./042-prisoner-of-impel-down.i18n.ts";

export const op16PrisonerOfImpelDown042: CharacterCard = {
  id: "OP16-042",
  canonicalId: "OP16-042",
  slug: "prisoner-of-impel-down/op16-042",
  name: "Prisoner of Impel Down",
  printings: [
    {
      id: "OP16-042",
      artId: "OP16-042",
      setCode: "OP16",
      collectorNumber: "042",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-042.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP16",
  cost: 6,
  power: 6000,
  counter: 2000,
  traits: ["Impel Down"],
  attribute: "strike",
  effect: "Under the rules of this game, you may have any number of this card in your deck.",
  effects: {
    // The whole printed text is a deck-construction rule, so this card has no in-game
    // behaviour at all. `deckBuildingRules` is declarative: nothing in packages/engine reads
    // it (grep -rn deckBuildingRules engine/src -> no hits), exactly as for the two existing
    // `unlimitedCopies` cards, OP01-075 Pacifista and OP08-072 Biscuit Warrior. It is
    // recorded so a deck builder / legality checker can act on it.
    //
    // "Prisoner of Impel Down" is a card NAME, not the "Impel Down" trait this card also
    // carries -- OP16-057 Captain Buggy's Our Savior!! and OP16-048 Buggy both count *this
    // card by name*, and both would be trivially satisfiable if they keyed on the trait,
    // which Bunkov, Antlerkov and both Buggy printings also carry. This card being a legal
    // 5-plus-of is what makes those name counts reachable at all.
    deckBuildingRules: [{ rule: "unlimitedCopies" }],
  },
  i18n: op16PrisonerOfImpelDown042I18n,
};
