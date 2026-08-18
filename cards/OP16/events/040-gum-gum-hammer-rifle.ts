import type { EventCard } from "@tcg/op-types";
import { op16GumGumHammerRifle040I18n } from "./040-gum-gum-hammer-rifle.i18n.ts";

export const op16GumGumHammerRifle040: EventCard = {
  id: "OP16-040",
  canonicalId: "OP16-040",
  slug: "gum-gum-hammer-rifle/op16-040",
  name: "Gum-Gum Hammer Rifle",
  printings: [
    {
      id: "OP16-040",
      artId: "OP16-040",
      setCode: "OP16",
      collectorNumber: "040",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-040.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  traits: ["Impel Down", "Straw Hat Crew"],
  effect:
    "[Main] If you have [Monkey.D.Luffy] and [Mr.3(Galdino)], up to 1 of your opponent's rested Characters with a cost of 6 or less will not become active in your opponent's next Refresh Phase.\n[Counter] Your Leader gains +3000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        // Ruling #986 pins `player: "self"` on BOTH halves: with only the opponent holding
        // Mr.3(Galdino) and you holding Monkey.D.Luffy, this cannot be used (不能).
        // `zone: "field"` (not "character") because "if you have [Name]" scans the whole field,
        // Leader included -- rulings #979/#993, and the two Leaders actually printed with these
        // names (OP16-022 is Monkey.D.Luffy) make it live rather than hypothetical here.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "field",
            filters: [{ filter: "name", value: "Monkey.D.Luffy" }],
          },
          {
            condition: "hasCard",
            player: "self",
            zone: "field",
            filters: [{ filter: "name", value: "Mr.3(Galdino)" }],
          },
        ],
        actions: [
          {
            action: "freeze",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [
                // The printed text names the state explicitly ("your opponent's RESTED
                // Characters"), which is what distinguishes this from OP15-022 Brook, where a
                // state filter would have been invented rather than read off the card.
                { filter: "state", value: "rested" },
                { filter: "cost", comparison: "lte", value: 6 },
              ],
            },
          },
        ],
      },
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
  i18n: op16GumGumHammerRifle040I18n,
};
