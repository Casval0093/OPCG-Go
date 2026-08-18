import type { CharacterCard } from "@tcg/op-types";
import { op15Orlumbus041I18n } from "./041-orlumbus.i18n.ts";

export const op15Orlumbus041: CharacterCard = {
  id: "OP15-041",
  canonicalId: "OP15-041",
  slug: "orlumbus/op15-041",
  name: "Orlumbus",
  printings: [
    {
      id: "OP15-041",
      artId: "OP15-041",
      setCode: "OP15",
      collectorNumber: "041",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-041.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Dressrosa", "Yonta Maria Fleet"],
  attribute: "strike",
  effect:
    "[On K.O.] Draw 1 card.\n[Activate: Main] [Once Per Turn] You may place 1 of your Characters at the bottom of the owner's deck: This Character gains [Rush] during this turn.",
  effects: {
    effects: [
      { trigger: "onKo", actions: [{ action: "draw", player: "self", amount: 1 }] },
      {
        // Ruling #894: this Character may pay its OWN cost -- placing Orlumbus himself at the
        // bottom of the deck is legal (可以), and the [Rush] grant then simply does nothing
        // ("什么都不会发生"). So the cost carries NO `excludeSelf`. The contrast card is
        // OP05-056 X Barrels, whose printed text says "other than this Character" and which does
        // carry `excludeSelf`; the closest same-wording precedent is EB03-026 Boa Hancock
        // ("You may place 1 of your Characters at the bottom of the owner's deck:"), which like
        // this card omits both `player` and `zones` and takes the defaults
        // (`zones: ["character"]`, the controller's own side).
        trigger: "activateMain",
        costs: [{ cost: "returnCharacterToDeck", amount: 1, position: "bottom" }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "rush",
            duration: "thisTurn",
          },
        ],
        optional: true,
        oncePerTurn: true,
      },
    ],
  },
  i18n: op15Orlumbus041I18n,
};
