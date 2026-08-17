import type { EventCard } from "@tcg/op-types";
import { op16GumGumHammerRifle040I18n } from "./040-gum-gum-hammer-rifle.i18n.ts";

export const op16GumGumHammerRifle040: EventCard = {
  id: "OP16-040",
  canonicalId: "OP16-040",
  slug: "gum-gum-hammer-rifle/op16-040",
  name: "Gum-Gum Hammer Rifle",
  printings: [
    {
      id: "OP16-040",
      artId: "OP16-040",
      setCode: "OP16",
      collectorNumber: "040",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-040.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  traits: ["Impel Down", "Straw Hat Crew"],
  effect:
    "[Main] If you have [Monkey.D.Luffy] and [Mr.3(Galdino)], up to 1 of your opponent's rested Characters with a cost of 6 or less will not become active in your opponent's next Refresh Phase.\n[Counter] Your Leader gains +3000 power during this battle.",
  i18n: op16GumGumHammerRifle040I18n,
};
