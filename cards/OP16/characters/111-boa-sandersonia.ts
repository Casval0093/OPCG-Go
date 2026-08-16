import type { CharacterCard } from "@tcg/op-types";
import { op16BoaSandersonia111I18n } from "./111-boa-sandersonia.i18n.ts";

export const op16BoaSandersonia111: CharacterCard = {
  id: "OP16-111",
  canonicalId: "OP16-111",
  slug: "boa-sandersonia/op16-111",
  name: "Boa Sandersonia",
  printings: [
    {
      id: "OP16-111",
      artId: "OP16-111",
      setCode: "OP16",
      collectorNumber: "111",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-111.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 5000,
  trigger: "If you have 2 or less Life cards, play this card.",
  traits: ["Kuja Pirates"],
  attribute: "strike",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)",
  i18n: op16BoaSandersonia111I18n,
};
