import type { CharacterCard } from "@tcg/op-types";
import { op16VanAugur103I18n } from "./103-van-augur.i18n.ts";

export const op16VanAugur103: CharacterCard = {
  id: "OP16-103",
  canonicalId: "OP16-103",
  slug: "van-augur/op16-103",
  name: "Van Augur",
  printings: [
    {
      id: "OP16-103",
      artId: "OP16-103",
      setCode: "OP16",
      collectorNumber: "103",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-103.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  trigger: "Activate this card's [On K.O.] effect.",
  traits: ["Blackbeard Pirates"],
  attribute: "ranged",
  effect:
    "[Opponent's Turn] [On K.O.] If your Leader has the [Blackbeard Pirates] type, draw 1 card and give up to 1 of your opponent's Leader or Character cards -3000 power during this turn.",
  effects: {
    effects: [
      {
        trigger: "onKo",
        conditions: [
          {
            // Ruling #1011: the [Opponent's Turn] qualifier binds to the [On K.O.] even when the
            // [Trigger] below is what activates it. Asked what happens when your own Leader takes
            // damage on YOUR turn and this [Trigger] fires, the answer is that the [On K.O.] does
            // not activate at all and the card just goes to the trash. `activateEffect` enqueues
            // the block rather than executing it, and a block's `conditions` are re-evaluated when
            // the queue reaches it (effects/resolution.ts), so this one condition covers both the
            // battle-K.O. path and the [Trigger] path.
            condition: "turn",
            value: "opponent",
          },
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
            action: "modifyPower",
            target: {
              player: "opponent",
              zones: ["leader", "character"],
              count: {
                amount: 1,
                upTo: true,
              },
            },
            value: -3000,
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
  i18n: op16VanAugur103I18n,
};
