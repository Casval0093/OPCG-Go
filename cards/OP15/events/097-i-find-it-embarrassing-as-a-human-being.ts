import type { EventCard } from "@tcg/op-types";
import { op15IFindItEmbarrassingAsAHumanBeing097I18n } from "./097-i-find-it-embarrassing-as-a-human-being.i18n.ts";

export const op15IFindItEmbarrassingAsAHumanBeing097: EventCard = {
  id: "OP15-097",
  canonicalId: "OP15-097",
  slug: "i-find-it-embarrassing-as-a-human-being/op15-097",
  name: "I Find It Embarrassing as a Human Being",
  printings: [
    {
      id: "OP15-097",
      artId: "OP15-097",
      setCode: "OP15",
      collectorNumber: "097",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-097.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  trigger: "Activate this card's [Main] effect.",
  traits: ["Straw Hat Crew"],
  effect:
    "[Main] If you have 10 or more cards in your trash, up to 1 of your opponent's Characters with a base cost of 5 or less cannot attack until the end of your opponent's next End Phase.",
  effects: {
    effects: [
      {
        trigger: "main",
        // Ruling #931 covers BOTH branches of this card at 9 cards in trash, and they differ:
        //  * played from HAND -> the [Main] works, because the Event is in the trash by the time its
        //    effect resolves, making 10.
        //  * activated via the [Trigger] below -> nothing happens, because a Life card with a Trigger
        //    goes to the `resolution` zone, not the trash (battle.ts), so the count is still 9.
        // Both fall out of the engine's own zone handling; neither needs special encoding, and the
        // test file asserts the pair so that stays true.
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 10 },
        ],
        actions: [
          {
            action: "cannotAttack",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              // `baseCost`, not `cost`: printed text is "a base cost of 5 or less" (原本的费用), so a
              // cost-6 Character discounted to 5 must NOT qualify.
              filters: [{ filter: "baseCost", comparison: "lte", value: 5 }],
            },
            duration: "untilEndOfOpponentNextEndPhase",
          },
        ],
      },
      {
        trigger: "trigger",
        // Modeled on OP03/events/017-cross-fire.ts.
        actions: [{ action: "activateEffect", effectTrigger: "main" }],
      },
    ],
  },
  i18n: op15IFindItEmbarrassingAsAHumanBeing097I18n,
};
