import type { CharacterCard } from "@tcg/op-types";
import { op16TrafalgarLaw068I18n } from "./068-trafalgar-law.i18n.ts";

export const op16TrafalgarLaw068: CharacterCard = {
  id: "OP16-068",
  canonicalId: "OP16-068",
  slug: "trafalgar-law/op16-068",
  name: "Trafalgar Law",
  printings: [
    {
      id: "OP16-068",
      artId: "OP16-068",
      setCode: "OP16",
      collectorNumber: "068",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-068.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 3000,
  counter: 1000,
  traits: ["Donquixote Pirates"],
  attribute: "wisdom",
  effect:
    "[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active.\n[When Attacking] If your Leader has the [Donquixote Pirates] type, this Character gains +3000 power during this turn.",
  i18n: op16TrafalgarLaw068I18n,
};
