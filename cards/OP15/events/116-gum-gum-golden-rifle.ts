import type { EventCard } from "@tcg/op-types";
import { op15GumGumGoldenRifle116I18n } from "./116-gum-gum-golden-rifle.i18n.ts";

export const op15GumGumGoldenRifle116: EventCard = {
  id: "OP15-116",
  canonicalId: "OP15-116",
  slug: "gum-gum-golden-rifle/op15-116",
  name: "Gum-Gum Golden Rifle",
  printings: [
    {
      id: "OP15-116",
      artId: "OP15-116",
      setCode: "OP15",
      collectorNumber: "116",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-116.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  traits: ["Sky Island", "Straw Hat Crew"],
  effect:
    "[Main] If your Leader has the [Straw Hat Crew] type, trash 1 card from the top of your Life cards. Then, add up to 1 card from the top of your deck to the top of your Life cards and trash 1 card from your hand.\n[Counter] Your Leader gains +4000 power during this battle.",
  i18n: op15GumGumGoldenRifle116I18n,
};
