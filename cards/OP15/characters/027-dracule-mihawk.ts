import type { CharacterCard } from "@tcg/op-types";
import { op15DraculeMihawk027I18n } from "./027-dracule-mihawk.i18n.ts";

export const op15DraculeMihawk027: CharacterCard = {
  id: "OP15-027",
  canonicalId: "OP15-027",
  slug: "dracule-mihawk/op15-027",
  name: "Dracule Mihawk",
  printings: [
    {
      id: "OP15-027",
      artId: "OP15-027",
      setCode: "OP15",
      collectorNumber: "027",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-027.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 2000,
  traits: ["East Blue", "The Seven Warlords of the Sea"],
  attribute: "slash",
  effect: "[On Play] Rest up to 1 of your opponent's Characters with a DON!! card given.",
  i18n: op15DraculeMihawk027I18n,
};
