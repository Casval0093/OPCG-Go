import type { CharacterCard } from "@tcg/op-types";
import { op15Bartolomeo014I18n } from "./014-bartolomeo.i18n.ts";

export const op15Bartolomeo014: CharacterCard = {
  id: "OP15-014",
  canonicalId: "OP15-014",
  slug: "bartolomeo/op15-014",
  name: "Bartolomeo",
  printings: [
    {
      id: "OP15-014",
      artId: "OP15-014",
      setCode: "OP15",
      collectorNumber: "014",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-014.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 6000,
  traits: ["Dressrosa", "Barto Club"],
  attribute: "special",
  effect:
    "If this Character would be K.O.'d, you may trash 1 Event from your hand instead.\n[On Play] Activate up to 1 [Dressrosa] type Event with a base cost of 3 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "activateEvent",
            target: {
              player: "self",
              zones: ["hand"],
              count: { amount: 1, upTo: true },
              // "a **base** cost of 3 or less" -- `baseCost`, not `cost`: an Event discounted to 3
              // by some other effect must NOT qualify. Same split as OP15-095/OP15-116 in Task 4.
              filters: [
                { filter: "cardCategory", value: "event" },
                { filter: "trait", value: "Dressrosa", match: "includes" },
                { filter: "baseCost", comparison: "lte", value: 3 },
              ],
            },
            effectTrigger: "main",
          },
        ],
      },
    ],
    replacementEffects: [
      {
        // 将要被KO with no cause named covers both a battle K.O. and an effect K.O., and
        // `replacedEvent: "ko"` is the one value findKoReplacement (effects/replacements.ts)
        // searches for in both cases. Shape from OP16/characters/018-rockstar.ts.
        replacedEvent: "ko",
        eventFilter: { targetSelf: true },
        replacementAction: {
          action: "trashFromHand",
          player: "self",
          amount: 1,
          // "1 Event" with no power or cost qualifier -- the card category is the whole filter.
          // Unlike a `play` action (whose pool is pre-narrowed to stage-or-character), a
          // `trashFromHand` scans the entire hand, so this really does exclude Characters.
          filters: [{ filter: "cardCategory", value: "event" }],
        },
      },
    ],
  },
  i18n: op15Bartolomeo014I18n,
};
