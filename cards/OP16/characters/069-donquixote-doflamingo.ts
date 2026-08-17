import type { CharacterCard } from "@tcg/op-types";
import { op16DonquixoteDoflamingo069I18n } from "./069-donquixote-doflamingo.i18n.ts";

export const op16DonquixoteDoflamingo069: CharacterCard = {
  id: "OP16-069",
  canonicalId: "OP16-069",
  slug: "donquixote-doflamingo/op16-069",
  name: "Donquixote Doflamingo",
  printings: [
    {
      id: "OP16-069",
      artId: "OP16-069",
      setCode: "OP16",
      collectorNumber: "069",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-069.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP16",
  cost: 7,
  power: 8000,
  traits: ["Donquixote Pirates"],
  attribute: "special",
  effect:
    "[On Play]/[When Attacking] Add up to 1 DON!! card from your DON!! deck and set it as active.",
  effects: {
    effects: [
      // "[A]/[B]" is two independent blocks with duplicated actions, not one combined trigger
      // (OP04-085 Suleiman). Each fires on its own timing and both can fire in one turn.
      {
        trigger: "onPlay",
        actions: [{ action: "addDon", count: { amount: 1, upTo: true }, state: "active" }],
      },
      {
        trigger: "whenAttacking",
        actions: [{ action: "addDon", count: { amount: 1, upTo: true }, state: "active" }],
      },
    ],
  },
  i18n: op16DonquixoteDoflamingo069I18n,
};
