import type { CharacterCard } from "@tcg/op-types";
import { op15MonkeyDLuffy119I18n } from "./119-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy119: CharacterCard = {
  id: "OP15-119",
  canonicalId: "OP15-119",
  slug: "monkey-d-luffy/op15-119",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-119",
      artId: "OP15-119",
      setCode: "OP15",
      collectorNumber: "119",
      rarity: "SEC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-119.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SEC",
  setId: "OP15",
  cost: 5,
  power: 7000,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If you have 6 or more DON!! cards on your field, this Character gains [Rush].\nWhen your opponent activates an Event or [Blocker], reveal up to 1 card from the top of your Life cards. This Character gains +1000 power during this turn per 1 cost on the revealed card.",
  // PARKED -- the second printed clause ("When your opponent activates an Event or [Blocker],
  // reveal up to 1 card from the top of your Life cards. This Character gains +1000 power during
  // this turn per 1 cost on the revealed card.") is NOT encoded. The triggers exist
  // (`whenOpponentActivatesEvent` and `whenBlockerActivated`, both on OP06-048 Zeff) and
  // `revealFromLife` exists, but there is no way to scale a `modifyPower` by the COST of the card
  // a preceding action revealed: `modifyPower`'s scaling fields are `valuePerPreviousActionTarget`
  // (per target, not per cost point), `valuePerCardGroup` (a candidate COUNT divided by a group
  // size) and `restedDonGroupSize`, and `revealFromLife` exposes its revealed card only through
  // `conditionalPlay`, which plays it rather than measuring it. This card is the only printing in
  // the whole pool using "per 1 cost". Rulings #945-#950 and #958-#960 constrain what the
  // primitive would have to do; see the batch report.
  effects: {
    permanentEffects: [
      {
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "gte", value: 6 }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "rush",
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15MonkeyDLuffy119I18n,
};
