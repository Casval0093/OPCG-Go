import type { CharacterCard } from "@tcg/op-types";
import { op16Buggy048I18n } from "./048-buggy.i18n.ts";

export const op16Buggy048: CharacterCard = {
  id: "OP16-048",
  canonicalId: "OP16-048",
  slug: "buggy/op16-048",
  name: "Buggy",
  printings: [
    {
      id: "OP16-048",
      artId: "OP16-048",
      setCode: "OP16",
      collectorNumber: "048",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-048.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Impel Down", "Buggy Pirates"],
  attribute: "slash",
  effect:
    "[On Play] If your Leader has the [Impel Down] type, draw 1 card and play up to 1 [Prisoner of Impel Down] card from your hand.\n[Once Per Turn] This effect can be activated when your opponent attacks. Up to 1 of your [Prisoner of Impel Down] cards gains [Blocker] during this turn.",
  i18n: op16Buggy048I18n,
};
