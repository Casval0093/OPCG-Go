import type { CharacterCard } from "@tcg/op-types";
import { op16BoaHancock112I18n } from "./112-boa-hancock.i18n.ts";

export const op16BoaHancock112: CharacterCard = {
  id: "OP16-112",
  canonicalId: "OP16-112",
  slug: "boa-hancock/op16-112",
  name: "Boa Hancock",
  printings: [
    {
      id: "OP16-112",
      artId: "OP16-112",
      setCode: "OP16",
      collectorNumber: "112",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-112.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 6,
  power: 8000,
  counter: 1000,
  traits: ["Kuja Pirates"],
  attribute: "special",
  i18n: op16BoaHancock112I18n,
};
