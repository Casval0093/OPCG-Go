import type { CharacterCard } from "@tcg/op-types";
import { op15Kyros042I18n } from "./042-kyros.i18n.ts";

export const op15Kyros042: CharacterCard = {
  id: "OP15-042",
  canonicalId: "OP15-042",
  slug: "kyros/op15-042",
  name: "Kyros",
  printings: [
    {
      id: "OP15-042",
      artId: "OP15-042",
      setCode: "OP15",
      collectorNumber: "042",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-042.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP15",
  cost: 3,
  power: 5000,
  traits: ["Dressrosa"],
  attribute: "slash",
  effect:
    "[On Play] You may trash 1 card from your hand: If your Leader is [Rebecca], this Character gains [Rush] during this turn.\n[On K.O.] Add this Character card from your trash to your hand.",
  effects: {
    effects: [
      {
        // The [Rebecca] check sits AFTER the cost colon, so it gates the payload only: the card
        // may be trashed with a non-Rebecca Leader and nothing is granted. Same placement as
        // OP16-065/OP16-070 and OP04-060 Crocodile; contrast a LEADING "If your Leader ..."
        // (OP15-046 Sabo below, ruling #944's shape), which gates the whole block.
        // `leaderName` is a LEADER check, so OP15-053 Rebecca -- a Character sharing the name --
        // never satisfies it; only OP04-039 / OP15-039 Rebecca do.
        trigger: "onPlay",
        costs: [{ cost: "trashFromHand", amount: 1 }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "rush",
            duration: "thisTurn",
            condition: { condition: "leaderName", name: "Rebecca" },
          },
        ],
        optional: true,
      },
      {
        // "Add this Character card **from your trash** to your hand": by the time an `onKo` block
        // resolves the card is already in the trash (the same ordering OP16-014 Marco's
        // `play` from `zone: "trash"` relies on), and `addThisCardToHand` (effects/actions.ts) is
        // zone-agnostic -- it moves the source instance to its owner's hand from wherever it is,
        // no-oping only when it is already in hand. No "may", so the block is mandatory.
        trigger: "onKo",
        actions: [{ action: "addThisCardToHand" }],
      },
    ],
  },
  i18n: op15Kyros042I18n,
};
