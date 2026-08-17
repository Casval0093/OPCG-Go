import type { CharacterCard } from "@tcg/op-types";
import { op16Mr3Galdino037I18n } from "./037-mr-3-galdino.i18n.ts";

export const op16Mr3Galdino037: CharacterCard = {
  id: "OP16-037",
  canonicalId: "OP16-037",
  slug: "mr-3-galdino/op16-037",
  name: "Mr.3(Galdino)",
  printings: [
    {
      id: "OP16-037",
      artId: "OP16-037",
      setCode: "OP16",
      collectorNumber: "037",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-037.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  power: 3000,
  counter: 1000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[On Play] If your Leader has the [Impel Down] type, rest up to 1 of your opponent's Characters with a cost of 5 or less.",
  i18n: op16Mr3Galdino037I18n,
};
