import type { CharacterCard } from "@tcg/op-types";
import { op15Enel060I18n } from "./060-enel.i18n.ts";

export const op15Enel060: CharacterCard = {
  id: "OP15-060",
  canonicalId: "OP15-060",
  slug: "enel/op15-060",
  name: "Enel",
  printings: [
    {
      id: "OP15-060",
      artId: "OP15-060",
      setCode: "OP15",
      collectorNumber: "060",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-060.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 8000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character cannot be removed from the field by your opponent's effects and gains +2000 power.\n[Activate: Main] DON!! -1: This Character gains [Blocker] until the end of your opponent's next End Phase. Then, trash 1 card from your hand.",
  i18n: op15Enel060I18n,
};
