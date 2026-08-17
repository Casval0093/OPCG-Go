import type { CharacterCard } from "@tcg/op-types";
import { op16RoronoaZoro053I18n } from "./053-roronoa-zoro.i18n.ts";

export const op16RoronoaZoro053: CharacterCard = {
  id: "OP16-053",
  canonicalId: "OP16-053",
  slug: "roronoa-zoro/op16-053",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP16-053",
      artId: "OP16-053",
      setCode: "OP16",
      collectorNumber: "053",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-053.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 7,
  power: 9000,
  traits: ["Dressrosa", "Supernovas", "Straw Hat Crew"],
  attribute: "slash",
  effect: "[When Attacking] If you have 6 or less cards in your hand, draw 1 card.",
  i18n: op16RoronoaZoro053I18n,
};
