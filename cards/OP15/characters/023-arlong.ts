import type { CharacterCard } from "@tcg/op-types";
import { op15Arlong023I18n } from "./023-arlong.i18n.ts";

export const op15Arlong023: CharacterCard = {
  id: "OP15-023",
  canonicalId: "OP15-023",
  slug: "arlong/op15-023",
  name: "Arlong",
  printings: [
    {
      id: "OP15-023",
      artId: "OP15-023",
      setCode: "OP15",
      collectorNumber: "023",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-023.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Fish-Man", "East Blue", "Arlong Pirates"],
  attribute: "slash",
  effect:
    "[On K.O.] Up to 2 of your opponent's rested cards will not become active in your opponent's next Refresh Phase.\n[Activate: Main] [Once Per Turn] You may give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters: Give up to 1 DON!! card from its owner's cost area to its owner's Leader or 1 of their Characters.",
  i18n: op15Arlong023I18n,
};
