import type { CharacterCard } from "@tcg/op-types";
import { op16SanjuanWolf106I18n } from "./106-sanjuan-wolf.i18n.ts";

export const op16SanjuanWolf106: CharacterCard = {
  id: "OP16-106",
  canonicalId: "OP16-106",
  slug: "sanjuan-wolf/op16-106",
  name: "Sanjuan.Wolf",
  printings: [
    {
      id: "OP16-106",
      artId: "OP16-106",
      setCode: "OP16",
      collectorNumber: "106",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-106.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  trigger: "Activate this card's [On K.O.] effect.",
  traits: ["Giant", "Impel Down", "Blackbeard Pirates"],
  attribute: "strike",
  effect:
    "[On K.O.] If your Leader has the [Blackbeard Pirates] type, draw 1 card, then up to 1 of your Leader or Character cards' base power becomes 7000 during this turn.",
  // `setBasePower`, not `setPower`, on the second half. `setPower` sets TOTAL power measured at
  // resolution, so a modifier already on the target -- attached DON!! on your Leader, a counter
  // boost -- would be absorbed instead of stacking on top of 7000. On a Leader in particular that
  // is the difference between a 7000 body and a 7000+1000-per-DON!! body.
  effects: {
    effects: [
      {
        trigger: "onKo",
        conditions: [
          {
            condition: "leaderTrait",
            trait: "Blackbeard Pirates",
            match: "includes",
          },
        ],
        actions: [
          {
            action: "draw",
            player: "self",
            amount: 1,
          },
          {
            // "then up to 1 of your Leader or Character cards' base power becomes 7000 during this
            // turn". "Leader or Character cards" is printed explicitly, so no ruling is needed to
            // justify the zone list here. `upTo` because the clause says "up to 1" -- declining is
            // legal, and Sanjuan.Wolf is often the K.O.'d body itself, so the effect frequently
            // resolves with nothing worth raising.
            action: "setBasePower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
            },
            value: 7000,
            duration: "thisTurn",
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "activateEffect",
            effectTrigger: "onKo",
          },
        ],
      },
    ],
  },
  i18n: op16SanjuanWolf106I18n,
};
