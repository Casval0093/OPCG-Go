import type { EventCard } from "@tcg/op-types";
import { op15TheOutcomeWillTellUsWhoSStrongAndWhoSWeak037I18n } from "./037-the-outcome-will-tell-us-who-s-strong-and-who-s-weak.i18n.ts";

export const op15TheOutcomeWillTellUsWhoSStrongAndWhoSWeak037: EventCard = {
  id: "OP15-037",
  canonicalId: "OP15-037",
  slug: "the-outcome-will-tell-us-who-s-strong-and-who-s-weak/op15-037",
  name: "The Outcome Will Tell Us Who's Strong and Who's Weak",
  printings: [
    {
      id: "OP15-037",
      artId: "OP15-037",
      setCode: "OP15",
      collectorNumber: "037",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-037.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  trigger: "Draw 1 card.",
  traits: ["East Blue", "Krieg Pirates"],
  effect:
    "[Main] Look at 5 cards from the top of your deck; reveal up to 1 [East Blue] type card other than [The Outcome Will Tell Us Who's Strong and Who's Weak] and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [
              { filter: "trait", value: "East Blue", match: "includes" },
              // "other than [The Outcome Will Tell Us Who's Strong and Who's Weak]" -- a second copy
              // of this very card in the deck is not a legal reveal.
              {
                filter: "excludeName",
                value: "The Outcome Will Tell Us Who's Strong and Who's Weak",
              },
            ],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [{ action: "draw", player: "self", amount: 1 }],
      },
    ],
  },
  i18n: op15TheOutcomeWillTellUsWhoSStrongAndWhoSWeak037I18n,
};
