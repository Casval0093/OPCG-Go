import type { CharacterCard } from "@tcg/op-types";
import { op16MohjiCabaji051I18n } from "./051-mohji-cabaji.i18n.ts";

export const op16MohjiCabaji051: CharacterCard = {
  id: "OP16-051",
  canonicalId: "OP16-051",
  slug: "mohji-cabaji/op16-051",
  name: "Mohji & Cabaji",
  printings: [
    {
      id: "OP16-051",
      artId: "OP16-051",
      setCode: "OP16",
      collectorNumber: "051",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-051.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 6,
  power: 7000,
  counter: 1000,
  traits: ["Cross Guild"],
  attribute: "slash",
  effect: "[On Play] If you have 5 or less cards in your hand, draw 2 cards.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // The [On Play] resolves after this card has already left the hand, so the count is
        // taken WITHOUT it -- 6 in hand before playing Mohji & Cabaji is 5 after, and the
        // condition holds. Encode the printed number; the offset is the engine's, not the
        // card's (the same reasoning as ruling #1013 on OP16-111 and #930/#931 on the
        // self-counting trash Events -- each zone has to be checked, not reasoned across).
        conditions: [{ condition: "handCount", player: "self", comparison: "lte", value: 5 }],
        actions: [{ action: "draw", player: "self", amount: 2 }],
      },
    ],
  },
  i18n: op16MohjiCabaji051I18n,
};
