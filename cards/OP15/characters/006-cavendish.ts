import type { CharacterCard } from "@tcg/op-types";
import { op15Cavendish006I18n } from "./006-cavendish.i18n.ts";

export const op15Cavendish006: CharacterCard = {
  id: "OP15-006",
  canonicalId: "OP15-006",
  slug: "cavendish/op15-006",
  name: "Cavendish",
  printings: [
    {
      id: "OP15-006",
      artId: "OP15-006",
      setCode: "OP15",
      collectorNumber: "006",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-006.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 2000,
  traits: ["Dressrosa", "Beautiful Pirates"],
  attribute: "slash",
  effect: "If you have 4 or more Events in your trash, this Character gains +2000 power.",
  effects: {
    permanentEffects: [
      {
        // A CHARACTER counting the trash counts only what is actually there. The self-counting
        // adjustments recorded elsewhere are both about the counting card's own movement -- an
        // Event is already in its own trash when its [Main] resolves (rulings #930/#931), and a
        // [Trigger] resolves from the resolution zone and so does not self-count -- and neither
        // applies to a body sitting on the field. Encode the printed number.
        conditions: [
          {
            condition: "zoneCount",
            player: "self",
            zone: "trash",
            comparison: "gte",
            value: 4,
            filters: [{ filter: "cardCategory", value: "event" }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            // `self: true` is not decoration: getPermanentModifierTotal (effects/permanent.ts)
            // skips any permanent modifier whose target is neither `self` nor `count.amount:
            // "all"`, so the alternative compiles, type-checks and silently never applies.
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
              self: true,
            },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Cavendish006I18n,
};
