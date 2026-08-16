import type { LeaderCard } from "@tcg/op-types";
import { op15Enel058I18n } from "./058-enel.i18n.ts";

export const op15Enel058: LeaderCard = {
  id: "OP15-058",
  canonicalId: "OP15-058",
  slug: "enel/op15-058",
  name: "Enel",
  printings: [
    {
      id: "OP15-058",
      artId: "OP15-058",
      setCode: "OP15",
      collectorNumber: "058",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-058.png",
    },
  ],
  cardType: "leader",
  color: ["purple"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 5,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "Under the rules of this game, your DON!! deck consists of 6 cards.\n[Activate: Main] [Once Per Turn] If it is your second turn or later, add up to 1 DON!! card from your DON!! deck and set it as active, and add up to 4 additional DON!! cards and rest them. Then, give up to 4 rested DON!! cards to 1 of your Characters.",
  i18n: op15Enel058I18n,
};
