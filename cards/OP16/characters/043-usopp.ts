import type { CharacterCard } from "@tcg/op-types";
import { op16Usopp043I18n } from "./043-usopp.i18n.ts";

export const op16Usopp043: CharacterCard = {
  id: "OP16-043",
  canonicalId: "OP16-043",
  slug: "usopp/op16-043",
  name: "Usopp",
  printings: [
    {
      id: "OP16-043",
      artId: "OP16-043",
      setCode: "OP16",
      collectorNumber: "043",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-043.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Dressrosa", "Straw Hat Crew"],
  attribute: "ranged",
  effect:
    "[Blocker]\n[On K.O.] You may rest 1 of your [Dressrosa] type Leader or Stage cards: Return up to 1 of your opponent's Characters with a cost of 5 or less to the owner's hand.",
  i18n: op16Usopp043I18n,
};
