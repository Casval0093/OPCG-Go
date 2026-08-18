import type { LeaderCard } from "@tcg/op-types";
import { op16MonkeyDLuffy022I18n } from "./022-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy022: LeaderCard = {
  id: "OP16-022",
  canonicalId: "OP16-022",
  slug: "monkey-d-luffy/op16-022",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-022",
      artId: "OP16-022",
      setCode: "OP16",
      collectorNumber: "022",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-022.png",
    },
  ],
  cardType: "leader",
  color: ["green", "blue"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 4,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[Activate: Main] [Once Per Turn] If the only Characters on your field are [Impel Down] type Characters, set up to 2 of your DON!! cards as active.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        conditions: [
          // Ruling #976 reverses the natural English reading, exactly as #852 does for OP15-001
          // Krieg: with ZERO Characters on your field this cannot be activated (不能). "If the
          // only Characters on your field are [Impel Down] type Characters" is vacuously TRUE of
          // an empty character area, so the `eq 0` non-Impel-Down check on its own -- which is the
          // whole shape EB02-010 Monkey.D.Luffy uses for this identical printed phrasing -- fires
          // on an empty field and gets the ruling backwards.
          //
          // The `gte 1` is deliberately UNFILTERED. Paired with the `eq 0` check below, "at least
          // 1 Impel Down Character" and "at least 1 Character" are the same predicate: if no
          // Character lacks the type, any Character at all has it. A trait filter here would be
          // dead weight no test could kill, which is what mutation_check.py flagged on Krieg.
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
            filters: [{ filter: "trait", value: "Impel Down", match: "includes", negate: true }],
          },
        ],
        actions: [
          {
            action: "setActive",
            target: {
              player: "self",
              zones: ["costArea"],
              count: { amount: 2, upTo: true },
            },
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16MonkeyDLuffy022I18n,
};
