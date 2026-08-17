import type { CharacterCard } from "@tcg/op-types";
import { op16TonyTonyChopper090I18n } from "./090-tony-tony-chopper.i18n.ts";

export const op16TonyTonyChopper090: CharacterCard = {
  id: "OP16-090",
  canonicalId: "OP16-090",
  slug: "tony-tony-chopper/op16-090",
  name: "Tony Tony.Chopper",
  printings: [
    {
      id: "OP16-090",
      artId: "OP16-090",
      setCode: "OP16",
      collectorNumber: "090",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-090.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Animal", "Land of Wano", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] Draw 2 cards and trash 2 cards from your hand. Then, K.O. up to 1 of your opponent's Characters with a cost of 1 or less.",
  i18n: op16TonyTonyChopper090I18n,
};
