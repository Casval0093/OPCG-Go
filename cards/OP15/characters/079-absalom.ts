import type { CharacterCard } from "@tcg/op-types";
import { op15Absalom079I18n } from "./079-absalom.i18n.ts";

export const op15Absalom079: CharacterCard = {
  id: "OP15-079",
  canonicalId: "OP15-079",
  slug: "absalom/op15-079",
  name: "Absalom",
  printings: [
    {
      id: "OP15-079",
      artId: "OP15-079",
      setCode: "OP15",
      collectorNumber: "079",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-079.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  trigger: "Activate this card's [On K.O.] effect.",
  traits: ["Thriller Bark Pirates"],
  attribute: "ranged",
  effect: "[On K.O.] Add up to 1 [Thriller Bark Pirates] type card from your trash to your hand.",
  effects: {
    effects: [
      {
        // Rulings #918/#919 are a matched pair about ONE zone fact, and neither needs a filter.
        // #918: resolving the [On K.O.] normally, this card may add ITSELF (可以) -- both K.O.
        // paths call `moveCard(... "trash")` BEFORE `enqueueEffectsForTrigger(... "onKo")`
        // (effects/actions.ts, battle.ts), so Absalom is already in the trash it scans.
        // #919: reached instead through the [Trigger] below it may NOT add itself (不可以) --
        // a Life card being activated sits in the `resolution` zone, not the trash. Both fall
        // out of scanning the trash and nothing else, so `excludeSelf` here would be WRONG.
        trigger: "onKo",
        actions: [
          {
            // "[Thriller Bark Pirates] type CARD", not "Character card" -- no `cardCategory`.
            // `returnToHand` over `zones: ["trash"]` is the established spelling for "add ...
            // from your trash to your hand" (OP16-097 Yamato, OP05-091 Rebecca).
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "trait", value: "Thriller Bark Pirates", match: "includes" }],
            },
          },
        ],
      },
      {
        // "[Trigger] Activate this card's [On K.O.] effect." -- shape from OP16-102 Avalo
        // Pizarro. `activateEffect` enqueues the onKo block rather than duplicating its actions.
        trigger: "trigger",
        actions: [{ action: "activateEffect", effectTrigger: "onKo" }],
      },
    ],
  },
  i18n: op15Absalom079I18n,
};
