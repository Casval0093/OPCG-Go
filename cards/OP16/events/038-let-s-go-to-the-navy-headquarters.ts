import type { EventCard } from "@tcg/op-types";
import { op16LetSGoToTheNavyHeadquarters038I18n } from "./038-let-s-go-to-the-navy-headquarters.i18n.ts";

export const op16LetSGoToTheNavyHeadquarters038: EventCard = {
  id: "OP16-038",
  canonicalId: "OP16-038",
  slug: "let-s-go-to-the-navy-headquarters/op16-038",
  name: "Let's Go!! To the Navy Headquarters!!",
  printings: [
    {
      id: "OP16-038",
      artId: "OP16-038",
      setCode: "OP16",
      collectorNumber: "038",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-038.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  traits: ["Impel Down", "Straw Hat Crew"],
  effect:
    "[Main] You may rest 6 of your DON!! cards: If you have 5 [Impel Down] type Characters with different card names, set your Leader and all of your Characters as active.\n[Counter] Your Leader gains +3000 power during this battle.",
  // PARKED -- the whole [Main] clause ("You may rest 6 of your DON!! cards: If you have 5
  // [Impel Down] type Characters with different card names, set your Leader and all of your
  // Characters as active") is NOT encoded below. The missing primitive is a DISTINCT-CARD-NAME
  // constraint on a Condition. `differentNames` exists, but only on the `play` and `playGrouped`
  // Actions, where it constrains a selection the player makes; nothing in the Condition vocabulary
  // (`zoneCount`, `combinedZoneCount`, `hasCard`, `zoneValueTotal`) can require that N matching
  // cards have N distinct names. Encoding it as a bare `zoneCount ... eq 5` with an Impel Down
  // trait filter would fire on five copies of one card, which this card's own text forbids, so per
  // the plan's settled decision the clause is parked rather than widened. The [Counter] half below
  // is fully encoded and tested.
  effects: {
    effects: [
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 3000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op16LetSGoToTheNavyHeadquarters038I18n,
};
