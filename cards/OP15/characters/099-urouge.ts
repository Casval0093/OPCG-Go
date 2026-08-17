import type { CharacterCard } from "@tcg/op-types";
import { op15Urouge099I18n } from "./099-urouge.i18n.ts";

export const op15Urouge099: CharacterCard = {
  id: "OP15-099",
  canonicalId: "OP15-099",
  slug: "urouge/op15-099",
  name: "Urouge",
  printings: [
    {
      id: "OP15-099",
      artId: "OP15-099",
      setCode: "OP15",
      collectorNumber: "099",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-099.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 6,
  power: 7000,
  counter: 1000,
  traits: ["Sky Island", "Supernovas", "Fallen Monk Pirates"],
  attribute: "strike",
  effect:
    "[On Play] You may trash 1 [Supernovas] type card from your hand: This Character gains [Rush] during this turn.\n[Activate: Main] You may turn 1 card from the top of your Life cards face-down: Give up to 1 rested DON!! card to your Leader or 1 of your Characters.",
  i18n: op15Urouge099I18n,
};
