import type { EventCard } from "@tcg/op-types";
import { op15WouldYouLetMeEatTheFlameFlameFruit056I18n } from "./056-would-you-let-me-eat-the-flame-flame-fruit.i18n.ts";

export const op15WouldYouLetMeEatTheFlameFlameFruit056: EventCard = {
  id: "OP15-056",
  canonicalId: "OP15-056",
  slug: "would-you-let-me-eat-the-flame-flame-fruit/op15-056",
  name: "Would You Let Me Eat the Flame-Flame Fruit?",
  printings: [
    {
      id: "OP15-056",
      artId: "OP15-056",
      setCode: "OP15",
      collectorNumber: "056",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-056.png",
    },
  ],
  cardType: "event",
  color: ["blue"],
  rarity: "C",
  setId: "OP15",
  cost: 7,
  trigger: "Draw 2 cards.",
  traits: ["Dressrosa", "Revolutionary Army"],
  effect:
    "[Main] Draw 2 cards. Then, your [Lucy] Leader gains [Double Attack] and +3000 power during this turn.\n(This card deals 2 damage.)",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          // Ruling #899 is decisive about WHERE the [Lucy] check goes: with a non-Lucy Leader you can
          // still draw 2 (可以). So the condition sits on the two later actions, NOT on the block --
          // the printed "your [Lucy] Leader gains ..." qualifies the target of the second sentence
          // rather than introducing a conditional over the whole effect. Contrast OP15-054 and
          // OP15-116, where a leading "If your Leader ..." does gate everything.
          { action: "draw", player: "self", amount: 2 },
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            keyword: "doubleAttack",
            duration: "thisTurn",
            condition: { condition: "leaderName", name: "Lucy" },
          },
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 3000,
            duration: "thisTurn",
            condition: { condition: "leaderName", name: "Lucy" },
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [{ action: "draw", player: "self", amount: 2 }],
      },
    ],
  },
  i18n: op15WouldYouLetMeEatTheFlameFlameFruit056I18n,
};
