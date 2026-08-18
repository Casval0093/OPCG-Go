import type { CharacterCard } from "@tcg/op-types";
import { op15Urouge099I18n } from "./099-urouge.i18n.ts";

export const op15Urouge099: CharacterCard = {
  id: "OP15-099",
  canonicalId: "OP15-099",
  slug: "urouge/op15-099",
  name: "Urouge",
  printings: [
    {
      id: "OP15-099",
      artId: "OP15-099",
      setCode: "OP15",
      collectorNumber: "099",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-099.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 6,
  power: 7000,
  counter: 1000,
  traits: ["Sky Island", "Supernovas", "Fallen Monk Pirates"],
  attribute: "strike",
  effect:
    "[On Play] You may trash 1 [Supernovas] type card from your hand: This Character gains [Rush] during this turn.\n[Activate: Main] You may turn 1 card from the top of your Life cards face-down: Give up to 1 rested DON!! card to your Leader or 1 of your Characters.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // "[Supernovas] type CARD", not Character: `trashFromHand` scans the whole hand and no
        // `cardCategory` filter is printed, so a Supernovas Event or Stage pays this too.
        costs: [
          {
            cost: "trashFromHand",
            amount: 1,
            filters: [{ filter: "trait", value: "Supernovas", match: "includes" }],
          },
        ],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "rush",
            duration: "thisTurn",
          },
        ],
        optional: true,
      },
      {
        trigger: "activateMain",
        // `faceUp: false` -- this turns the top Life card face-DOWN, the opposite direction from
        // the more common OP13-114/OP15-114 shape. Ruling #934 (top Life card already face-down,
        // or 0 Life cards -> 不可以) needs no condition of its own: `canPayCosts` rejects a
        // `turnLifeFaceUp` whose target cards are already in the requested state, and rejects it
        // outright when `life.length < count`. Adding a `faceUpLife` condition here would be an
        // unkillable mutant, exactly as a `lifeCount` condition would have been on OP15-098.
        costs: [{ cost: "turnLifeFaceUp", count: 1, faceUp: false }],
        actions: [
          {
            action: "giveDon",
            // "your Leader OR 1 of your Characters" -- both zones, no trait filter. Same shape as
            // OP16-021 Moby Dick's identical printed sentence.
            target: { player: "self", zones: ["leader", "character"], count: { amount: 1 } },
            count: { amount: 1, upTo: true },
            donState: "rested",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Urouge099I18n,
};
