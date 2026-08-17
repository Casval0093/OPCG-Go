import type { EventCard } from "@tcg/op-types";
import { op15ItSAnOrderDoNotDefyMe038I18n } from "./038-it-s-an-order-do-not-defy-me.i18n.ts";

export const op15ItSAnOrderDoNotDefyMe038: EventCard = {
  id: "OP15-038",
  canonicalId: "OP15-038",
  slug: "it-s-an-order-do-not-defy-me/op15-038",
  name: "It's an Order! Do Not Defy Me!!!",
  printings: [
    {
      id: "OP15-038",
      artId: "OP15-038",
      setCode: "OP15",
      collectorNumber: "038",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-038.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  traits: ["East Blue", "Krieg Pirates"],
  effect:
    "[Main] Up to 1 of your opponent's rested Characters with a cost of 8 or less that has 2 or more DON!! cards given will not become active in your opponent's next Refresh Phase.\n[Counter] Up to 1 of your [Krieg] cards gains +4000 power during this battle.",
  // PARKED -- the [Main] clause ("up to 1 of your opponent's rested Characters with a cost of 8 or
  // less that has 2 or more DON!! cards given will not become active in your opponent's next Refresh
  // Phase") is NOT encoded below. It needs a TargetFilter over a candidate's attached DON!! count,
  // and there is none: `instance.attachedDon` exists in engine state but `matchesTargetFilter`
  // (effects/targeting.ts) has no case for it, and `givenDonCount` is a Condition over a player's
  // total rather than a per-candidate filter. This is the same gap that parks OP15-001 Krieg's second
  // clause. Ruling #892 also pins what the primitive would have to do: the DON!! check happens at
  // SELECTION time only -- a Character that later stops having 2+ DON!! given stays frozen (不会
  // become active), so it must not be re-evaluated in the Refresh Phase.
  effects: {
    effects: [
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              // "your [Krieg] cards" -- bracketed name, and both a Leader (OP15-001) and a Character
              // (OP15-008) are named Krieg, so the pool is Leader + Character rather than just
              // Characters.
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Krieg" }],
            },
            value: 4000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op15ItSAnOrderDoNotDefyMe038I18n,
};
