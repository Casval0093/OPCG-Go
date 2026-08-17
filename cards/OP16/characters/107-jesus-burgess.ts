import type { CharacterCard } from "@tcg/op-types";
import { op16JesusBurgess107I18n } from "./107-jesus-burgess.i18n.ts";

export const op16JesusBurgess107: CharacterCard = {
  id: "OP16-107",
  canonicalId: "OP16-107",
  slug: "jesus-burgess/op16-107",
  name: "Jesus Burgess",
  printings: [
    {
      id: "OP16-107",
      artId: "OP16-107",
      setCode: "OP16",
      collectorNumber: "107",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-107.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 5000,
  trigger: "You may trash 1 card from your hand: Play this card.",
  traits: ["Blackbeard Pirates"],
  attribute: "strike",
  effect:
    "[On K.O.] Add up to 1 card from the top of your opponent's Life cards to the owner's hand.",
  i18n: op16JesusBurgess107I18n,
};
