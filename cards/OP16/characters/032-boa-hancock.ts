import type { CharacterCard } from "@tcg/op-types";
import { op16BoaHancock032I18n } from "./032-boa-hancock.i18n.ts";

export const op16BoaHancock032: CharacterCard = {
  id: "OP16-032",
  canonicalId: "OP16-032",
  slug: "boa-hancock/op16-032",
  name: "Boa Hancock",
  printings: [
    {
      id: "OP16-032",
      artId: "OP16-032",
      setCode: "OP16",
      collectorNumber: "032",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-032.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "SR",
  setId: "OP16",
  cost: 7,
  power: 9000,
  traits: ["Impel Down", "The Seven Warlords of the Sea", "Kuja Pirates"],
  attribute: "special",
  effect:
    "[Unblockable] (This card cannot be blocked.)\n[On Play] Up to 1 of your opponent's Characters other than [Monkey.D.Luffy] cannot be rested until the end of your opponent's next End Phase.",
  i18n: op16BoaHancock032I18n,
};
