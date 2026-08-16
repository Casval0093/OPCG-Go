import type { CharacterCard } from "@tcg/op-types";
import { op16PortgasDAce049I18n } from "./049-portgas-d-ace.i18n.ts";

export const op16PortgasDAce049: CharacterCard = {
  id: "OP16-049",
  canonicalId: "OP16-049",
  slug: "portgas-d-ace/op16-049",
  name: "Portgas.D.Ace",
  printings: [
    {
      id: "OP16-049",
      artId: "OP16-049",
      setCode: "OP16",
      collectorNumber: "049",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-049.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 0,
  counter: 1000,
  traits: ["Impel Down", "Whitebeard Pirates"],
  attribute: "special",
  effect: "[Activate: Main] You may rest this Character: Draw 1 card.",
  i18n: op16PortgasDAce049I18n,
};
