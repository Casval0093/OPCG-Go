import type { CharacterCard } from "@tcg/op-types";
import { op15MeowbanBrothers028I18n } from "./028-meowban-brothers.i18n.ts";

export const op15MeowbanBrothers028: CharacterCard = {
  id: "OP15-028",
  canonicalId: "OP15-028",
  slug: "meowban-brothers/op15-028",
  name: "Meowban Brothers",
  printings: [
    {
      id: "OP15-028",
      artId: "OP15-028",
      setCode: "OP15",
      collectorNumber: "028",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-028.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["East Blue", "Black Cat Pirates"],
  attribute: "slash",
  effect:
    "[On Play] If your Leader has the [East Blue] type, give up to 1 DON!! card from your opponent's cost area to 1 of your opponent's Characters.",
  i18n: op15MeowbanBrothers028I18n,
};
