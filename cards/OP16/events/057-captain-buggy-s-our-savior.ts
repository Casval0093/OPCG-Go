import type { EventCard } from "@tcg/op-types";
import { op16CaptainBuggySOurSavior057I18n } from "./057-captain-buggy-s-our-savior.i18n.ts";

export const op16CaptainBuggySOurSavior057: EventCard = {
  id: "OP16-057",
  canonicalId: "OP16-057",
  slug: "captain-buggy-s-our-savior/op16-057",
  name: "Captain Buggy's Our Savior!!",
  printings: [
    {
      id: "OP16-057",
      artId: "OP16-057",
      setCode: "OP16",
      collectorNumber: "057",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-057.png",
    },
  ],
  cardType: "event",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  trigger: "Draw 2 cards and trash 1 card from your hand.",
  traits: ["Impel Down"],
  effect:
    "[Counter] If you have 2 or more [Prisoner of Impel Down] cards, up to 1 of your Leader or Character cards gains +4000 power during this battle.",
  i18n: op16CaptainBuggySOurSavior057I18n,
};
