import type { StageCard } from "@tcg/op-types";
import { op16MobyDick021I18n } from "./021-moby-dick.i18n.ts";

export const op16MobyDick021: StageCard = {
  id: "OP16-021",
  canonicalId: "OP16-021",
  slug: "moby-dick/op16-021",
  name: "Moby Dick",
  printings: [
    {
      id: "OP16-021",
      artId: "OP16-021",
      setCode: "OP16",
      collectorNumber: "021",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-021.png",
    },
  ],
  cardType: "stage",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  traits: ["Whitebeard Pirates"],
  effect:
    "[On Play] If your Leader has the [Whitebeard Pirates] type, look at 3 cards from the top of your deck and add up to 1 card to your hand. Then, place the rest at the bottom of your deck in any order.\n[Activate: Main] You may trash this Stage: Give up to 1 rested DON!! card to your Leader or 1 of your Characters.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // The Leader check leads the sentence, so it gates the whole [On Play] -- including the
        // "Then, place the rest at the bottom" half, which is part of the same search action.
        conditions: [{ condition: "leaderTrait", trait: "Whitebeard Pirates", match: "includes" }],
        actions: [
          {
            action: "search",
            lookCount: 3,
            source: { player: "self", zone: "deck" },
            // "add up to 1 card" with no restriction: any of the three qualifies.
            revealCount: { amount: 1, upTo: true },
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
      {
        // Verbatim the same printed ability as OP03-009 Haruta, minus its [Once Per Turn]: this
        // one is limited by trashing the Stage instead.
        trigger: "activateMain",
        costs: [{ cost: "trashThisCard" }],
        actions: [
          {
            action: "giveDon",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1 },
            },
            count: { amount: 1, upTo: true },
            donState: "rested",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16MobyDick021I18n,
};
