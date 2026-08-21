import type { CharacterCard } from "@tcg/op-types";
import { st30Mr3Galdino014I18n } from "./014-mr-3-galdino.i18n.ts";

export const st30Mr3Galdino014: CharacterCard = {
  id: "ST30-014",
  canonicalId: "ST30-014",
  slug: "mr-3-galdino/st30-014",
  name: "Mr.3(Galdino)",
  printings: [
    {
      id: "ST30-014",
      artId: "ST30-014",
      setCode: "ST30",
      collectorNumber: "014",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/ST30-014.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "ST30",
  cost: 2,
  power: 3000,
  counter: 2000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: Give up to 2 of your Characters with 6000 base power up to 2 rested DON!! cards each.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "restThisCard" }],
        actions: [
          {
            // Own DON!!, own Characters -- ordinary `giveDon`, not `giveDonSourcePlayer`
            // (that parked primitive hands the opponent's DON!! to a source-player target).
            // `distribution: "each"` is the existing give-N-to-each-of-M verb (OP08-001
            // Chopper: up to 3 Characters, 1 rested DON!! each). The each-path pays
            // `count.amount` per selected target and ignores `count.upTo`, so Chopper
            // prints "up to 1 each" as `{ amount: 1 }` with no upTo; this card mirrors
            // that as `{ amount: 2 }`.
            // Ruling #255: "原本的力量为6000" is exactly 6000, `basePower eq`, not current
            // power and not a gte/lte band.
            action: "giveDon",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 2, upTo: true },
              filters: [{ filter: "basePower", comparison: "eq", value: 6000 }],
            },
            count: { amount: 2 },
            donState: "rested",
            distribution: "each",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: st30Mr3Galdino014I18n,
};
