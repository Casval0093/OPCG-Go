import type { CharacterCard } from "@tcg/op-types";
import { op15TonyTonyChopper085I18n } from "./085-tony-tony-chopper.i18n.ts";

export const op15TonyTonyChopper085: CharacterCard = {
  id: "OP15-085",
  canonicalId: "OP15-085",
  slug: "tony-tony-chopper/op15-085",
  name: "Tony Tony.Chopper",
  printings: [
    {
      id: "OP15-085",
      artId: "OP15-085",
      setCode: "OP15",
      collectorNumber: "085",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-085.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 2,
  power: 2000,
  counter: 1000,
  traits: ["Animal", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] Trash 3 cards from the top of your deck.\n[Activate: Main] You may trash this Character: If your Leader has the [Straw Hat Crew] type, add up to 1 [Straw Hat Crew] type Character card other than [Tony Tony.Chopper] from your trash to your hand.",
  i18n: op15TonyTonyChopper085I18n,
};
