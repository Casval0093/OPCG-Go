import type { CharacterCard } from "@tcg/op-types";
import { op16JesusBurgess107I18n } from "./107-jesus-burgess.i18n.ts";

export const op16JesusBurgess107: CharacterCard = {
  id: "OP16-107",
  canonicalId: "OP16-107",
  slug: "jesus-burgess/op16-107",
  name: "Jesus Burgess",
  printings: [
    {
      id: "OP16-107",
      artId: "OP16-107",
      setCode: "OP16",
      collectorNumber: "107",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-107.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 5000,
  trigger: "You may trash 1 card from your hand: Play this card.",
  traits: ["Blackbeard Pirates"],
  attribute: "strike",
  effect:
    "[On K.O.] Add up to 1 card from the top of your opponent's Life cards to the owner's hand.",
  effects: {
    effects: [
      {
        trigger: "onKo",
        actions: [
          {
            // "to the owner's hand" -- removeLifeCards (effects/actions.ts) sends a `hand`
            // destination to the Life card's own controller, so the opponent gets it back, and
            // the default position with no `position` key is the TOP of Life.
            action: "removeFromLife",
            player: "opponent",
            count: {
              amount: 1,
              upTo: true,
            },
            destination: "hand",
          },
        ],
      },
      {
        trigger: "trigger",
        // Ruling #1012: with an empty hand this card cannot be played by its own [Trigger]. That
        // falls out of the discard being a real `cost` -- an unpayable cost means the optional
        // block is never even offered -- and would NOT hold if the discard were an action.
        costs: [
          {
            cost: "trashFromHand",
            amount: 1,
          },
        ],
        actions: [
          {
            action: "playThisCard",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16JesusBurgess107I18n,
};
