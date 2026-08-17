import type { EventCard } from "@tcg/op-types";
import { op16HallowedGlacierSlash100I18n } from "./100-hallowed-glacier-slash.i18n.ts";

export const op16HallowedGlacierSlash100: EventCard = {
  id: "OP16-100",
  canonicalId: "OP16-100",
  slug: "hallowed-glacier-slash/op16-100",
  name: "Hallowed Glacier Slash",
  printings: [
    {
      id: "OP16-100",
      artId: "OP16-100",
      setCode: "OP16",
      collectorNumber: "100",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-100.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  traits: ["Land of Wano"],
  effect:
    "[Main] You may rest 2 of your DON!! cards: If your opponent's Character has been K.O.'d during this turn, set your Leader [Yamato] as active.\n[Counter] Your Leader gains +3000 power during this battle.",
  i18n: op16HallowedGlacierSlash100I18n,
};
