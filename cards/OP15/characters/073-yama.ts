import type { CharacterCard } from "@tcg/op-types";
import { op15Yama073I18n } from "./073-yama.i18n.ts";

export const op15Yama073: CharacterCard = {
  id: "OP15-073",
  canonicalId: "OP15-073",
  slug: "yama/op15-073",
  name: "Yama",
  printings: [
    {
      id: "OP15-073",
      artId: "OP15-073",
      setCode: "OP15",
      collectorNumber: "073",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-073.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Sky Island"],
  attribute: "slash",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] Play up to 1 [Heavenly Warriors] with a cost of 1 or up to 1 [Vassals] type Character card with a cost of 1 from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            // "up to 1 ... or up to 1 ..." is ONE card matching either description, not one of
            // each: the SC reads 最多1张 ... 的"神兵"或 ... 的角色卡牌, a single count over a
            // disjunction.
            count: { amount: 1, upTo: true },
            filters: [
              {
                filter: "anyOf",
                groups: [
                  // Ruling #912: "a cost of 1" is EXACTLY 1 (费用为1) -- a cost-2-or-more
                  // [Heavenly Warriors] or [Vassals] Character cannot be played (不可以). `eq`,
                  // not `lte`. The cost filter is duplicated into each group on purpose, the
                  // OP16-001 Ace shape: written once outside the `anyOf` it would still read
                  // correctly today, but the disjunct-local copy is what makes "the cost binds to
                  // only one branch" structurally inexpressible.
                  [
                    // The first branch is asymmetric in both the English and the SC: no card-type
                    // qualifier at all, only the name. Do not "tidy" a cardCategory into it.
                    { filter: "name", value: "Heavenly Warriors" },
                    { filter: "cost", comparison: "eq", value: 1 },
                  ],
                  [
                    { filter: "trait", value: "Vassals", match: "includes" },
                    { filter: "cost", comparison: "eq", value: 1 },
                    // ... whereas the second branch prints "Character card" (角色卡牌). A `play`
                    // action's candidate pool is pre-filtered to stage-or-character
                    // (candidatesForPlayAction), so the only job left for this filter is to
                    // exclude a Stage.
                    { filter: "cardCategory", value: "character" },
                  ],
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15Yama073I18n,
};
