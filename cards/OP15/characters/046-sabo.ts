import type { CharacterCard } from "@tcg/op-types";
import { op15Sabo046I18n } from "./046-sabo.i18n.ts";

export const op15Sabo046: CharacterCard = {
  id: "OP15-046",
  canonicalId: "OP15-046",
  slug: "sabo/op15-046",
  name: "Sabo",
  printings: [
    {
      id: "OP15-046",
      artId: "OP15-046",
      setCode: "OP15",
      collectorNumber: "046",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-046.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP15",
  cost: 7,
  power: 9000,
  traits: ["Dressrosa", "Revolutionary Army"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] If your Leader has the [Dressrosa] type, activate up to 1 [Dressrosa] type Event from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        // The [Dressrosa] Leader check LEADS the sentence, so it gates the whole block
        // (`conditions`), not just the action -- ruling #944's shape, and the opposite placement
        // to OP15-042 Kyros above. Ruling #896: an Event's [Counter] can NOT be activated this
        // way (不可以); `ActivateEventAction.effectTrigger` is typed
        // `Extract<EffectTrigger, "main">`, so that is enforced at compile time and only the
        // [Main] block is ever enqueued. Ruling #895: after the activated Event resolves it goes
        // to the trash unless its own text says otherwise -- generic `moveCard` behaviour, not
        // something this encoding states. Modeled on OP15-014 Bartolomeo / OP12-041 Sanji, minus
        // their printed `baseCost` limit, which this card does not have.
        trigger: "onPlay",
        conditions: [{ condition: "leaderTrait", trait: "Dressrosa", match: "includes" }],
        actions: [
          {
            action: "activateEvent",
            target: {
              player: "self",
              zones: ["hand"],
              count: { amount: 1, upTo: true },
              filters: [
                { filter: "cardCategory", value: "event" },
                { filter: "trait", value: "Dressrosa", match: "includes" },
              ],
            },
            effectTrigger: "main",
          },
        ],
      },
    ],
  },
  i18n: op15Sabo046I18n,
};
