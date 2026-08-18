import type { CharacterCard } from "@tcg/op-types";
import { op15TonyTonyChopper085I18n } from "./085-tony-tony-chopper.i18n.ts";

export const op15TonyTonyChopper085: CharacterCard = {
  id: "OP15-085",
  canonicalId: "OP15-085",
  slug: "tony-tony-chopper/op15-085",
  name: "Tony Tony.Chopper",
  printings: [
    {
      id: "OP15-085",
      artId: "OP15-085",
      setCode: "OP15",
      collectorNumber: "085",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-085.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 2,
  power: 2000,
  counter: 1000,
  traits: ["Animal", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[On Play] Trash 3 cards from the top of your deck.\n[Activate: Main] You may trash this Character: If your Leader has the [Straw Hat Crew] type, add up to 1 [Straw Hat Crew] type Character card other than [Tony Tony.Chopper] from your trash to your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [{ action: "trashFromDeck", player: "self", amount: 3 }],
      },
      {
        // The Leader check sits AFTER the cost colon, so it gates only the payload: the cost is
        // payable with the wrong Leader and buys nothing. Precedent OP16-065 / OP04-060
        // Crocodile. Contrast OP15-081 Sanji in this same batch, whose identical [Straw Hat
        // Crew] check LEADS its sentence and therefore gates the whole block.
        trigger: "activateMain",
        costs: [{ cost: "trashThisCard" }],
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [
                { filter: "cardCategory", value: "character" },
                { filter: "trait", value: "Straw Hat Crew", match: "includes" },
                // "other than [Tony Tony.Chopper]" is a NAME exclusion, not `excludeSelf`: a
                // second copy of Chopper in the trash is excluded too, and this card has
                // already left the field to pay the cost anyway.
                { filter: "excludeName", value: "Tony Tony.Chopper" },
              ],
            },
            condition: { condition: "leaderTrait", trait: "Straw Hat Crew", match: "includes" },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15TonyTonyChopper085I18n,
};
