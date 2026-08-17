import type { CharacterCard } from "@tcg/op-types";
import { op16SanjuanWolf106I18n } from "./106-sanjuan-wolf.i18n.ts";

export const op16SanjuanWolf106: CharacterCard = {
  id: "OP16-106",
  canonicalId: "OP16-106",
  slug: "sanjuan-wolf/op16-106",
  name: "Sanjuan.Wolf",
  printings: [
    {
      id: "OP16-106",
      artId: "OP16-106",
      setCode: "OP16",
      collectorNumber: "106",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-106.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  trigger: "Activate this card's [On K.O.] effect.",
  traits: ["Giant", "Impel Down", "Blackbeard Pirates"],
  attribute: "strike",
  effect:
    "[On K.O.] If your Leader has the [Blackbeard Pirates] type, draw 1 card, then up to 1 of your Leader or Character cards' base power becomes 7000 during this turn.",
  i18n: op16SanjuanWolf106I18n,
};
