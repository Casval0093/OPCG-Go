import type { LeaderCard } from "@tcg/op-types";
import { op15Krieg001I18n } from "./001-krieg.i18n.ts";

export const op15Krieg001: LeaderCard = {
  id: "OP15-001",
  canonicalId: "OP15-001",
  slug: "krieg/op15-001",
  name: "Krieg",
  printings: [
    {
      id: "OP15-001",
      artId: "OP15-001",
      setCode: "OP15",
      collectorNumber: "001",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-001.png",
    },
  ],
  cardType: "leader",
  color: ["red", "green"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 4,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "slash",
  effect:
    "[DON!! x1] [Opponent's Turn] If the only Characters on your field are [East Blue] type Characters, give all of your opponent's Characters -2000 power.\n[Activate: Main] [Once Per Turn] Rest up to 1 of your opponent's Characters that has 2 or more DON!! cards given.",
  i18n: op15Krieg001I18n,
};
