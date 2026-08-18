import type { CharacterCard } from "@tcg/op-types";
import { op15Goro065I18n } from "./065-goro.i18n.ts";

export const op15Goro065: CharacterCard = {
  id: "OP15-065",
  canonicalId: "OP15-065",
  slug: "goro/op15-065",
  name: "Goro",
  printings: [
    {
      id: "OP15-065",
      artId: "OP15-065",
      setCode: "OP15",
      collectorNumber: "065",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-065.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 0,
  counter: 2000,
  traits: ["Alabasta", "Hot Springs Island"],
  attribute: "wisdom",
  effect:
    "[On Play] Reveal 1 card from the top of your deck. If the revealed card has a cost of 2 or less, add up to 1 DON!! card from your DON!! deck and rest it.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            // `revealFromDeck`, not `revealTopDeckCard`: the printed text gives no placement
            // instruction, so the revealed card stays where it was. `revealFromDeck` finalizes at
            // `position: "top"` unconditionally (effects/actions.ts); `revealTopDeckCard` demands
            // a `finalPosition` and is the verb for cards that print "... and place it at the top
            // or bottom" (OP08-049) or "Then, place the revealed card at the bottom" (OP04-011).
            // Model: OP14EB04-044 Edward Newgate, the only other user of this action.
            action: "revealFromDeck",
            player: "self",
            count: 1,
            ifRevealedCardMatches: {
              filters: [{ filter: "cost", comparison: "lte", value: 2 }],
              actions: [{ action: "addDon", count: { amount: 1, upTo: true }, state: "rested" }],
            },
          },
        ],
      },
    ],
  },
  i18n: op15Goro065I18n,
};
