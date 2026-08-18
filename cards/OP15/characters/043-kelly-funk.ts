import type { CharacterCard } from "@tcg/op-types";
import { op15KellyFunk043I18n } from "./043-kelly-funk.i18n.ts";

export const op15KellyFunk043: CharacterCard = {
  id: "OP15-043",
  canonicalId: "OP15-043",
  slug: "kelly-funk/op15-043",
  name: "Kelly Funk",
  printings: [
    {
      id: "OP15-043",
      artId: "OP15-043",
      setCode: "OP15",
      collectorNumber: "043",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-043.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 3000,
  counter: 1000,
  traits: ["Dressrosa", "Mogaro Kingdom"],
  attribute: "strike",
  effect: "[On Play] Play up to 1 [Bobby Funk] from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            // "[Bobby Funk]" is a bracketed card NAME (OP15-050), the only card in the pool
            // carrying it. Deliberately no `cardCategory: "character"` beside it: a `play`
            // action's pool is already pre-narrowed to character-or-stage
            // (`candidatesForPlayAction`), so the only thing `cardCategory` could add here is
            // "exclude a Stage named Bobby Funk", and no such card exists -- it would be an
            // unkillable redundant filter.
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "name", value: "Bobby Funk" }],
          },
        ],
      },
    ],
  },
  i18n: op15KellyFunk043I18n,
};
