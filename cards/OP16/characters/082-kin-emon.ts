import type { CharacterCard } from "@tcg/op-types";
import { op16KinEmon082I18n } from "./082-kin-emon.i18n.ts";

export const op16KinEmon082: CharacterCard = {
  id: "OP16-082",
  canonicalId: "OP16-082",
  slug: "kin-emon/op16-082",
  name: "Kin'emon",
  printings: [
    {
      id: "OP16-082",
      artId: "OP16-082",
      setCode: "OP16",
      collectorNumber: "082",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-082.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Land of Wano", "The Akazaya Nine"],
  attribute: "slash",
  effect:
    "This Character gains +3 cost.\n[On Play] If your Leader has the [Land of Wano] type, look at 5 cards from the top of your deck; reveal up to 1 [Land of Wano] type card and add it to your hand. Then, trash the rest.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        conditions: [{ condition: "leaderTrait", trait: "Land of Wano", match: "includes" }],
        actions: [
          {
            // Modeled on OP04-092 Rebecca / OP03-094 Air Door. Note "reveal up to 1 [Land of
            // Wano] type CARD", not "Character card" -- no cardCategory filter belongs here.
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [{ filter: "trait", value: "Land of Wano", match: "includes" }],
            revealDestination: "hand",
            remainderPosition: "trash",
          },
        ],
      },
    ],
    // "This Character gains +3 cost." -- a static self modifier, same shape as OP08-084 Jack
    // (cost 7 printed, 11 on the field). `zones: ["character"]` is what keeps this off the
    // card while it is still in hand: getPermanentModifierTotal has a `sourceIsSelfInHand`
    // escape hatch for cards that modify *themselves in hand*, but it still requires the
    // action's own target pool to contain the card, and a hand card is not in the character
    // area. So Kin'emon costs the printed 4 to play and is a cost-7 body once on the field.
    permanentEffects: [
      {
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 3,
          },
        ],
      },
    ],
  },
  i18n: op16KinEmon082I18n,
};
