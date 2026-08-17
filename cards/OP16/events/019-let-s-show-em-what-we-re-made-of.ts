import type { EventCard } from "@tcg/op-types";
import { op16LetSShowEmWhatWeReMadeOf019I18n } from "./019-let-s-show-em-what-we-re-made-of.i18n.ts";

export const op16LetSShowEmWhatWeReMadeOf019: EventCard = {
  id: "OP16-019",
  canonicalId: "OP16-019",
  slug: "let-s-show-em-what-we-re-made-of/op16-019",
  name: "Let's Show 'Em What We're Made Of!!",
  printings: [
    {
      id: "OP16-019",
      artId: "OP16-019",
      setCode: "OP16",
      collectorNumber: "019",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-019.png",
    },
  ],
  cardType: "event",
  color: ["red"],
  rarity: "C",
  setId: "OP16",
  cost: 9,
  trigger: "Your Leader gains +1000 power during this turn.",
  traits: ["Whitebeard Pirates"],
  effect:
    '[Main] Play up to 2 Character cards with a type including "Whitebeard Pirates" and 8000 power from your hand.',
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 2, upTo: true },
            filters: [
              { filter: "trait", value: "Whitebeard Pirates", match: "includes" },
              // Ruling #974: "8000 power" is EXACTLY 8000 -- neither 7000-or-less nor
              // 9000-or-more qualifies (不, 是指力量刚好为8000的角色卡牌). Same reading as
              // #962/#963. There is deliberately no `cardCategory: "character"` filter: a Stage's
              // power is hard-zeroed by basePower() (effects/shared.ts), so `power eq 8000`
              // already excludes every non-Character, and a redundant filter is a mutant no test
              // could ever kill.
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 1000,
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op16LetSShowEmWhatWeReMadeOf019I18n,
};
