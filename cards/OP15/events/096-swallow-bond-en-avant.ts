import type { EventCard } from "@tcg/op-types";
import { op15SwallowBondEnAvant096I18n } from "./096-swallow-bond-en-avant.i18n.ts";

export const op15SwallowBondEnAvant096: EventCard = {
  id: "OP15-096",
  canonicalId: "OP15-096",
  slug: "swallow-bond-en-avant/op15-096",
  name: "Swallow Bond en Avant",
  printings: [
    {
      id: "OP15-096",
      artId: "OP15-096",
      setCode: "OP15",
      collectorNumber: "096",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-096.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 0,
  traits: ["Straw Hat Crew"],
  effect:
    "[Main] You may rest 1 of your DON!! cards: If your Leader has the [Straw Hat Crew] type, trash 5 cards from the top of your deck.\n[Counter] You may trash 1 card from your hand: Up to 1 of your Leader or Character cards gains +3000 power during this battle.",
  i18n: op15SwallowBondEnAvant096I18n,
};
