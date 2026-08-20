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
  // `setBasePower`, not `setPower`, on the [Main] clause. `setPower` is a delta against the
  // target's CURRENT power (`value: action.value - currentPower`), so it absorbs modifiers already
  // present: a Prisoner carrying a DON!! +1000 should end at 8000 under the printed text and would
  // end at 7000 under `setPower`. The engine's one `setPower` user, OP07-002 Ain, prints "Set the
  // POWER of ... to 0" rather than base power, which is the reading `setPower` implements.
  effects: {
    effects: [
      {
        trigger: "main",
        // The DON!! check leads the sentence, so it gates the whole clause. `eq 10`, not `gte`:
        // that is how every existing "If you have 10 DON!! cards on your field" in the engine is
        // written (OP01-091 King, OP05-040 Birdcage, OP05-062 O-Nami, OP16-116 Zehahahahaha).
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "eq", value: 10 }],
        actions: [
          {
            action: "setBasePower",
            target: {
              player: "self",
              // Ruling #994: with a Leader whose own effect grants it every card name, this [Main]
              // takes the LEADER's base power to 7000 too (是的). So the zone list spans
              // leader + character -- the same Leader-inclusion trap as rulings #979/#993, and the
              // same breadth the [Counter] half below already carries.
              //
              // "[Prisoner of Impel Down]" is a card NAME, not a trait: the SC text quotes it
              // ("因佩尔地狱的囚犯") where a trait would be in angle brackets, and OP16-042 is a
              // real card with exactly that name, printed at 6000 base.
              zones: ["leader", "character"],
              count: { amount: "all" },
              filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
            },
            value: 7000,
            duration: "thisTurn",
          },
        ],
      },
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
