import type { EventCard } from "@tcg/op-types";
import { op16CaptainBuggySOurSavior057I18n } from "./057-captain-buggy-s-our-savior.i18n.ts";

export const op16CaptainBuggySOurSavior057: EventCard = {
  id: "OP16-057",
  canonicalId: "OP16-057",
  slug: "captain-buggy-s-our-savior/op16-057",
  name: "Captain Buggy's Our Savior!!",
  printings: [
    {
      id: "OP16-057",
      artId: "OP16-057",
      setCode: "OP16",
      collectorNumber: "057",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-057.png",
    },
  ],
  cardType: "event",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  trigger: "Draw 2 cards and trash 1 card from your hand.",
  traits: ["Impel Down"],
  effect:
    "[Counter] If you have 2 or more [Prisoner of Impel Down] cards, up to 1 of your Leader or Character cards gains +4000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "counter",
        // "[Prisoner of Impel Down]" is the bracketed NAME of OP16-042 (a card explicitly
        // printed with "you may have any number of this card in your deck"), not the
        // broader "Impel Down" trait this event and OP16-042 both also carry -- that trait
        // is shared by Bunkov/Antlerkov/Buggy too and would make the condition far too
        // easy to satisfy.
        // Ruling #993: a Leader whose own effect grants it every card's name/trait/attribute
        // makes "2 or more" hold with only 1 real Prisoner of Impel Down on field -- the
        // Leader is the second one. Same "if you have [Name]" pattern as ruling #979 on
        // Antlerkov (OP16-029): the scan has to include the Leader, so `zone: "field"`, not
        // `zone: "character"`. See cards/tests/OP16/057-captain-buggy-s-our-savior.test.ts
        // and cards/ENCODING.md.
        conditions: [
          {
            condition: "zoneCount",
            player: "self",
            zone: "field",
            comparison: "gte",
            value: 2,
            filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: {
                amount: 1,
                upTo: true,
              },
            },
            value: 4000,
            duration: "thisBattle",
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "draw",
            player: "self",
            amount: 2,
          },
          {
            action: "trashFromHand",
            player: "self",
            amount: 1,
          },
        ],
      },
    ],
  },
  i18n: op16CaptainBuggySOurSavior057I18n,
};
