import type { CharacterCard } from "@tcg/op-types";
import { op16KinEmon082I18n } from "./082-kin-emon.i18n.ts";

export const op16KinEmon082: CharacterCard = {
  id: "OP16-082",
  canonicalId: "OP16-082",
  slug: "kin-emon/op16-082",
  name: "Kin'emon",
  printings: [
    {
      id: "OP16-082",
      artId: "OP16-082",
      setCode: "OP16",
      collectorNumber: "082",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-082.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Land of Wano", "The Akazaya Nine"],
  attribute: "slash",
  effect:
    "This Character gains +3 cost.\n[On Play] If your Leader has the [Land of Wano] type, look at 5 cards from the top of your deck; reveal up to 1 [Land of Wano] type card and add it to your hand. Then, trash the rest.",
  i18n: op16KinEmon082I18n,
};
