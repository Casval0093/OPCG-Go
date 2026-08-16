import type { CharacterCard } from "@tcg/op-types";
import { op15NicoRobin087I18n } from "./087-nico-robin.i18n.ts";

export const op15NicoRobin087: CharacterCard = {
  id: "OP15-087",
  canonicalId: "OP15-087",
  slug: "nico-robin/op15-087",
  name: "Nico Robin",
  printings: [
    {
      id: "OP15-087",
      artId: "OP15-087",
      setCode: "OP15",
      collectorNumber: "087",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-087.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 5,
  power: 7000,
  traits: ["Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If you have 10 or more cards in your trash, this Character gains [Blocker].\n[On Play] Draw 2 cards and trash 2 cards from your hand.",
  i18n: op15NicoRobin087I18n,
};
