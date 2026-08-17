import type { EventCard } from "@tcg/op-types";
import { op16BlackVortex115I18n } from "./115-black-vortex.i18n.ts";

export const op16BlackVortex115: EventCard = {
  id: "OP16-115",
  canonicalId: "OP16-115",
  slug: "black-vortex/op16-115",
  name: "Black Vortex",
  printings: [
    {
      id: "OP16-115",
      artId: "OP16-115",
      setCode: "OP16",
      collectorNumber: "115",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-115.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  trigger:
    "Negate the effect of up to 1 of your opponent's Leader or Character cards during this turn.",
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  effect:
    "[Main] If your Leader has the [Blackbeard Pirates] type, add up to 1 card with a [Trigger] other than [Black Vortex] from your trash to your hand.",
  effects: {
    effects: [
      {
        trigger: "main",
        conditions: [{ condition: "leaderTrait", trait: "Blackbeard Pirates", match: "includes" }],
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [
                { filter: "hasTrigger", value: true },
                // Ruling #1014: "other than [Black Vortex]" excludes OP09-097 Black Vortex too
                // (不能) -- a DIFFERENT card with the same name, which itself has a [Trigger] and
                // would otherwise qualify. So the exclusion is by NAME (`excludeName`), never by
                // card id.
                { filter: "excludeName", value: "Black Vortex" },
              ],
            },
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "negateEffects",
            target: {
              player: "opponent",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
            },
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op16BlackVortex115I18n,
};
