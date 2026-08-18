import type { CharacterCard } from "@tcg/op-types";
import { op15PiratesDockingSix088I18n } from "./088-pirates-docking-six.i18n.ts";

export const op15PiratesDockingSix088: CharacterCard = {
  id: "OP15-088",
  canonicalId: "OP15-088",
  slug: "pirates-docking-six/op15-088",
  name: "Pirates Docking Six",
  printings: [
    {
      id: "OP15-088",
      artId: "OP15-088",
      setCode: "OP15",
      collectorNumber: "088",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-088.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 5,
  power: 7000,
  traits: ["Straw Hat Crew"],
  attribute: "strike",
  effect:
    "This Character gains +6 cost.\n[On Play] You may trash 3 cards from the top of your deck: Play up to 1 [Straw Hat Crew] type Character card with a cost of 2 or less from your trash.",
  effects: {
    // "This Character gains +6 cost." -- same static self modifier as OP16-082 Kin'emon.
    // `zones: ["character"]` is what keeps it off the card in hand, so it still costs the
    // printed 5 to play and is a cost-11 body once on the field (dodging "cost 7 or less"
    // removal). `getCardCost` sums `getPermanentModifierTotal(..., "cost")`, so this is live.
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 6,
          },
        ],
      },
    ],
    effects: [
      {
        // There is no "trash N from the top of your deck" COST primitive, so the mill is an
        // action and the payload hangs off its `thenActions`. That is not a workaround:
        // `trashTopDeckCards` runs `thenActions` only when the FULL requested amount was
        // trashed, which is exactly cost semantics -- a 2-card deck mills nothing and plays
        // nothing. Ruling #924 confirms the other half: one of the 3 cards just milled is a
        // legal target, which follows from the mill resolving before the play.
        trigger: "onPlay",
        actions: [
          {
            action: "trashFromDeck",
            player: "self",
            amount: 3,
            thenActions: [
              {
                action: "play",
                source: { player: "self", zone: "trash" },
                count: { amount: 1, upTo: true },
                filters: [
                  { filter: "cardCategory", value: "character" },
                  { filter: "trait", value: "Straw Hat Crew", match: "includes" },
                  { filter: "cost", comparison: "lte", value: 2 },
                ],
              },
            ],
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15PiratesDockingSix088I18n,
};
