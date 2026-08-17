import type { CharacterCard } from "@tcg/op-types";
import { op16Crocodile045I18n } from "./045-crocodile.i18n.ts";

export const op16Crocodile045: CharacterCard = {
  id: "OP16-045",
  canonicalId: "OP16-045",
  slug: "crocodile/op16-045",
  name: "Crocodile",
  printings: [
    {
      id: "OP16-045",
      artId: "OP16-045",
      setCode: "OP16",
      collectorNumber: "045",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-045.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] You may return 1 of your Characters with a cost of 2 or more to the owner's hand: Play up to 1 [Impel Down] type Character card with a cost of 2 or less from your hand.",
  i18n: op16Crocodile045I18n,
};
