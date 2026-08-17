import type { EventCard } from "@tcg/op-types";
import { op16ThePrisonersAreRioting058I18n } from "./058-the-prisoners-are-rioting.i18n.ts";

export const op16ThePrisonersAreRioting058: EventCard = {
  id: "OP16-058",
  canonicalId: "OP16-058",
  slug: "the-prisoners-are-rioting/op16-058",
  name: "The Prisoners Are Rioting!!",
  printings: [
    {
      id: "OP16-058",
      artId: "OP16-058",
      setCode: "OP16",
      collectorNumber: "058",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-058.png",
    },
  ],
  cardType: "event",
  color: ["blue"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  traits: ["Impel Down"],
  effect:
    "[Main] If you have 10 DON!! cards on your field, all of your [Prisoner of Impel Down] cards' base power becomes 7000 during this turn.\n[Counter] Up to 1 of your [Buggy] gains +4000 power during this battle.",
  // PARKED -- the [Main] clause ("If you have 10 DON!! cards on your field, all of your [Prisoner
  // of Impel Down] cards' base power becomes 7000 during this turn") is NOT encoded below. The
  // missing primitive is an action that sets BASE power to a literal value. `setBasePowerFrom`
  // copies a base power from another card and cannot take a number; `setPower` is the only
  // literal-valued option and it is implemented as a delta against the target's CURRENT power
  // (effects/actions.ts: `value: action.value - currentPower`), so it silently absorbs modifiers
  // that already exist instead of preserving them -- a Prisoner already carrying a DON!! +1000
  // should end at 8000 under the printed text and would end at 7000 under `setPower`. The engine's
  // one `setPower` user (OP07-002 Ain) prints "Set the POWER of ... to 0", not base power, which is
  // the reading `setPower` actually implements.
  //
  // Ruling #994 is the other half of what this clause needs and is recorded here so it is not
  // re-derived: with a Leader whose own effect grants it every card name, this [Main] sets the
  // LEADER's base power to 7000 too (是的). So the target must be `zones: ["leader", "character"]`,
  // not `["character"]` -- the same Leader-inclusion trap as rulings #979/#993. The [Counter] half
  // below is fully encoded and tested.
  effects: {
    effects: [
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              // "your [Buggy]" is a card, not a Character: OP16-041 is itself a Leader named
              // Buggy, so the Leader is a legal recipient.
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Buggy" }],
            },
            value: 4000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op16ThePrisonersAreRioting058I18n,
};
