import type { CharacterCard } from "@tcg/op-types";
import { op15NicoRobin109I18n } from "./109-nico-robin.i18n.ts";

export const op15NicoRobin109: CharacterCard = {
  id: "OP15-109",
  canonicalId: "OP15-109",
  slug: "nico-robin/op15-109",
  name: "Nico Robin",
  printings: [
    {
      id: "OP15-109",
      artId: "OP15-109",
      setCode: "OP15",
      collectorNumber: "109",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-109.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] You may add 1 card from the top of your Life cards to your hand: If your Leader has the [Straw Hat Crew] type, add up to 1 card from the top of your deck to the top of your Life cards. Then, play up to 1 [Sky Island] type Character card with a cost of 5 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Ruling #940: at 0 Life cards neither half of the payload can be performed (不可以).
        // That falls out of `canPayCosts` rejecting `addLifeToHand` with an empty Life area, so
        // there is no condition to write for it.
        costs: [{ cost: "addLifeToHand", amount: 1, position: "top" }],
        actions: [
          {
            // The [Straw Hat Crew] check sits AFTER the cost colon, so it gates the payload and
            // not the activation -- the Life card may be paid with a non-Straw-Hat Leader and buy
            // nothing (OP16-065's placement, precedent OP04-060 Crocodile). But within the
            // payload it LEADS the sentence and the "Then," half hangs off it, which is ruling
            // #944's shape on OP15-116: the same 场合...之后 grammar, where without the type the
            // "Then," half does not happen either. One `sequence` carrying one condition
            // expresses exactly that -- gate below the cost, above both actions.
            action: "sequence",
            condition: { condition: "leaderTrait", trait: "Straw Hat Crew", match: "includes" },
            actions: [
              {
                action: "addToLife",
                target: { player: "self", zones: ["deck"], count: { amount: 1, upTo: true } },
                position: "top",
              },
              {
                action: "play",
                source: { player: "self", zone: "hand" },
                count: { amount: 1, upTo: true },
                filters: [
                  { filter: "trait", value: "Sky Island", match: "includes" },
                  { filter: "cost", comparison: "lte", value: 5 },
                  // Load-bearing: `candidatesForPlayAction` pre-filters to character-or-stage, so
                  // this filter's only job is excluding Stages -- and OP05-117 Upper Yard and
                  // OP06-117 The Ark Maxim are both cost-1 [Sky Island] Stages that would
                  // otherwise qualify.
                  { filter: "cardCategory", value: "character" },
                ],
              },
            ],
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15NicoRobin109I18n,
};
