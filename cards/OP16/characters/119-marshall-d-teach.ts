import type { CharacterCard } from "@tcg/op-types";
import { op16MarshallDTeach119I18n } from "./119-marshall-d-teach.i18n.ts";

export const op16MarshallDTeach119: CharacterCard = {
  id: "OP16-119",
  canonicalId: "OP16-119",
  slug: "marshall-d-teach/op16-119",
  name: "Marshall.D.Teach",
  printings: [
    {
      id: "OP16-119",
      artId: "OP16-119",
      setCode: "OP16",
      collectorNumber: "119",
      rarity: "SEC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-119.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SEC",
  setId: "OP16",
  cost: 8,
  power: 10000,
  trigger:
    "Negate the effect of up to 1 of your opponent's Characters during this turn. Then, K.O. up to 1 of your opponent's Characters with a cost of 5 or less.",
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  attribute: "special",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; add up to 1 card to the top of your Life cards. Then, place the rest at the bottom of your deck in any order.",
  // PARKED -- the [On Play] half ("Look at 3 cards from the top of your deck; add up to 1 card to
  // the top of your Life cards. Then, place the rest at the bottom of your deck in any order.") is
  // NOT encoded. `search` is the only look-N-then-order-the-remainder verb in the DSL, and its
  // handler (effects/actions.ts, `case "search"`) hard-rejects any `revealDestination` other than
  // "hand" or "character": it records an `action:search:configuration` capability issue and
  // enqueues a judge prompt instead of resolving. Missing primitive: `revealDestination: "life"`
  // support on `search`, placing the revealed card face-DOWN (ruling #1018: the card added this way
  // is not shown to the opponent). Only the [Trigger] below is encoded.
  effects: {
    effects: [
      {
        trigger: "trigger",
        actions: [
          {
            action: "negateEffects",
            target: {
              player: "opponent",
              zones: ["character"],
              count: {
                amount: 1,
                upTo: true,
              },
            },
            duration: "thisTurn",
          },
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: {
                amount: 1,
                upTo: true,
              },
              filters: [
                {
                  filter: "cost",
                  comparison: "lte",
                  value: 5,
                },
              ],
            },
          },
        ],
      },
    ],
  },
  i18n: op16MarshallDTeach119I18n,
};
