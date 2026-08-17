import type { EventCard } from "@tcg/op-types";
import { op15AndNoOneElseCanHaveItItSOurMementoOfHim054I18n } from "./054-and-no-one-else-can-have-it-it-s-our-memento-of-him.i18n.ts";

export const op15AndNoOneElseCanHaveItItSOurMementoOfHim054: EventCard = {
  id: "OP15-054",
  canonicalId: "OP15-054",
  slug: "and-no-one-else-can-have-it-it-s-our-memento-of-him/op15-054",
  name: "And No One Else Can Have It! It's Our Memento of Him",
  printings: [
    {
      id: "OP15-054",
      artId: "OP15-054",
      setCode: "OP15",
      collectorNumber: "054",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-054.png",
    },
  ],
  cardType: "event",
  color: ["blue"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  traits: ["Dressrosa", "Revolutionary Army"],
  effect:
    "[Main] If your Leader is [Lucy], choose one:\n• Draw 2 cards and trash 1 card from your hand. Then, play up to 1 [Dressrosa] type Character card with a cost of 4 or less from your hand.\n• Return up to 1 Stage to the owner's hand.",
  effects: {
    effects: [
      {
        trigger: "main",
        // "If your Leader is [Lucy]" is a leading conditional over the whole effect, so it gates the
        // block rather than an individual action.
        conditions: [{ condition: "leaderName", name: "Lucy" }],
        actions: [
          {
            action: "choice",
            options: [
              [
                { action: "draw", player: "self", amount: 2 },
                { action: "trashFromHand", player: "self", amount: 1 },
                {
                  action: "play",
                  source: { player: "self", zone: "hand" },
                  count: { amount: 1, upTo: true },
                  filters: [
                    { filter: "cardCategory", value: "character" },
                    { filter: "trait", value: "Dressrosa", match: "includes" },
                    { filter: "cost", comparison: "lte", value: 4 },
                  ],
                },
              ],
              [
                {
                  action: "returnToHand",
                  // "up to 1 Stage" with no possessive -- either player's Stage is a legal target.
                  target: { player: "any", zones: ["stage"], count: { amount: 1, upTo: true } },
                },
              ],
            ],
          },
        ],
      },
    ],
  },
  i18n: op15AndNoOneElseCanHaveItItSOurMementoOfHim054I18n,
};
