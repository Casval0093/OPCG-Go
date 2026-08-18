import type { CharacterCard } from "@tcg/op-types";
import { op16Buggy031I18n } from "./031-buggy.i18n.ts";

export const op16Buggy031: CharacterCard = {
  id: "OP16-031",
  canonicalId: "OP16-031",
  slug: "buggy/op16-031",
  name: "Buggy",
  printings: [
    {
      id: "OP16-031",
      artId: "OP16-031",
      setCode: "OP16",
      collectorNumber: "031",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-031.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Impel Down", "Buggy Pirates"],
  attribute: "slash",
  effect: "[On K.O.] Play up to 1 [Prisoner of Impel Down] card from your hand.",
  effects: {
    effects: [
      {
        trigger: "onKo",
        // A bare [On K.O.] with no `source`, so it fires on a battle K.O. as well as an
        // effect one. "[Prisoner of Impel Down]" is the bracketed card NAME of OP16-042, not
        // the broader "Impel Down" trait this Buggy itself carries -- a trait filter here
        // would let Buggy replay half the deck. Also no cost filter: the print restricts the
        // card by name only. `cardCategory` would be dead weight, since every card with that
        // name is a Character.
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
          },
        ],
      },
    ],
  },
  i18n: op16Buggy031I18n,
};
