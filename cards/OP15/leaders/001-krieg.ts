import type { LeaderCard } from "@tcg/op-types";
import { op15Krieg001I18n } from "./001-krieg.i18n.ts";

export const op15Krieg001: LeaderCard = {
  id: "OP15-001",
  canonicalId: "OP15-001",
  slug: "krieg/op15-001",
  name: "Krieg",
  printings: [
    {
      id: "OP15-001",
      artId: "OP15-001",
      setCode: "OP15",
      collectorNumber: "001",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-001.png",
    },
  ],
  cardType: "leader",
  color: ["red", "green"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 4,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "slash",
  effect:
    "[DON!! x1] [Opponent's Turn] If the only Characters on your field are [East Blue] type Characters, give all of your opponent's Characters -2000 power.\n[Activate: Main] [Once Per Turn] Rest up to 1 of your opponent's Characters that has 2 or more DON!! cards given.",
  // PARKED -- the second printed clause ("[Activate: Main] [Once Per Turn] Rest up to 1 of your
  // opponent's Characters that has 2 or more DON!! cards given") is NOT encoded below. There is no
  // TargetFilter that reads a candidate's attached DON!! count: `instance.attachedDon` exists in
  // engine state, but `matchesTargetFilter` (effects/targeting.ts) has no case for it, and
  // `givenDonCount` is a Condition over a player's total rather than a per-candidate filter. The
  // clause is therefore unencodable without a new primitive, and per the plan's settled decision it
  // is parked rather than approximated. See cards/ENCODING.md "Parked".
  effects: {
    permanentEffects: [
      {
        conditions: [
          { condition: "donAttached", amount: 1 },
          { condition: "turn", value: "opponent" },
          // Ruling #852 is decisive and reverses the natural English reading: with ZERO Characters
          // on your field this effect does NOT apply (不会). "If the only Characters on your field
          // are [East Blue] type Characters" is vacuously TRUE of an empty character area, so the
          // `eq 0` non-East-Blue check *on its own* -- which is the whole shape EB02-010
          // Monkey.D.Luffy uses for this identical printed phrasing -- fires on an empty field and
          // gets the ruling backwards. The unfiltered `gte 1` below is what makes #852 expressible.
          //
          // It is deliberately UNFILTERED, and that is not laziness: paired with the `eq 0` check
          // that follows, "at least 1 East Blue Character" and "at least 1 Character" are the same
          // predicate -- if no Character lacks the type then any Character at all is an East Blue
          // one. A trait filter here would therefore be dead weight that no test could ever kill,
          // which is exactly what mutation_check.py flagged when it was present.
          {
            condition: "zoneCount",
            player: "self",
            zone: "character",
            comparison: "gte",
            value: 1,
          },
          {
            condition: "zoneCount",
            player: "self",
            zone: "character",
            comparison: "eq",
            value: 0,
            filters: [{ filter: "trait", value: "East Blue", match: "includes", negate: true }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: "all" },
            },
            value: -2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Krieg001I18n,
};
