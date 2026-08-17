import type { CharacterCard } from "@tcg/op-types";
import { op16Buggy048I18n } from "./048-buggy.i18n.ts";

export const op16Buggy048: CharacterCard = {
  id: "OP16-048",
  canonicalId: "OP16-048",
  slug: "buggy/op16-048",
  name: "Buggy",
  printings: [
    {
      id: "OP16-048",
      artId: "OP16-048",
      setCode: "OP16",
      collectorNumber: "048",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-048.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Impel Down", "Buggy Pirates"],
  attribute: "slash",
  effect:
    "[On Play] If your Leader has the [Impel Down] type, draw 1 card and play up to 1 [Prisoner of Impel Down] card from your hand.\n[Once Per Turn] This effect can be activated when your opponent attacks. Up to 1 of your [Prisoner of Impel Down] cards gains [Blocker] during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // The Leader check is the LEADING clause of this sentence, so it gates the whole
        // block -- both the draw and the play (the OP15-116 / ruling #944 side of the split
        // in cards/ENCODING.md, not the OP15-056 / #899 side where the check sits in a
        // later "Then," sentence and gates only that action).
        conditions: [{ condition: "leaderTrait", trait: "Impel Down", match: "includes" }],
        actions: [
          { action: "draw", player: "self", amount: 1 },
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            // NAME, not trait. "Impel Down" is a trait this card, Bunkov, Antlerkov and
            // both Buggy printings all carry; "Prisoner of Impel Down" is the name of
            // OP16-042 specifically. No `cardCategory` filter: no card of any other type
            // carries this name, so one would be an unkillable redundancy.
            filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
          },
        ],
      },
      {
        // "[Once Per Turn] This effect can be activated when your opponent attacks" is the
        // wording OP09-001 Shanks prints verbatim: trigger `onOpponentAttack`, `optional`,
        // `oncePerTurn`. Ruling #991 confirms the [Blocker] granted this way may be used
        // against the very attack that triggered it -- that is the engine's generic
        // ordering (the modifier lands before the blocker step opens), not something this
        // encoding has to state.
        trigger: "onOpponentAttack",
        actions: [
          {
            action: "grantKeyword",
            target: {
              player: "self",
              // "your [Prisoner of Impel Down] CARDS", not Characters -- same reading as
              // OP16-039's "[Monkey.D.Luffy] cards", and the same reason rulings #979/#993
              // put the Leader inside a name scan: a Leader that carries the name is a
              // legal recipient.
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
            },
            keyword: "blocker",
            duration: "thisTurn",
          },
        ],
        optional: true,
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16Buggy048I18n,
};
