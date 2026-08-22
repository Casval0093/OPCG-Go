import type { LeaderCard } from "@tcg/op-types";
import { op16PortgasDAce001I18n } from "./001-portgas-d-ace.i18n.ts";

export const op16PortgasDAce001: LeaderCard = {
  id: "OP16-001",
  canonicalId: "OP16-001",
  slug: "portgas-d-ace/op16-001",
  name: "Portgas.D.Ace",
  printings: [
    {
      id: "OP16-001",
      artId: "OP16-001",
      setCode: "OP16",
      collectorNumber: "001",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-001.png",
    },
  ],
  cardType: "leader",
  color: ["red"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 5,
  traits: ["Whitebeard Pirates"],
  attribute: "special",
  effect:
    '[Activate: Main] [Once Per Turn] Up to 1 of your [Monkey.D.Luffy] Characters or up to 1 of your Characters with a type including "Whitebeard Pirates", with 8000 power or more, gains [Rush] during this turn.',
  effects: {
    effects: [
      {
        trigger: "activateMain",
        actions: [
          {
            action: "grantKeyword",
            target: {
              player: "self",
              zones: ["character"],
              count: {
                amount: 1,
                upTo: true,
              },
              filters: [
                {
                  filter: "anyOf",
                  // Ruling #961: "8000 power or more" binds to BOTH the [Monkey.D.Luffy]
                  // clause and the Whitebeard Pirates clause -- so the power filter is
                  // duplicated inside each group rather than ANDed once outside the anyOf.
                  // A 7000-power Whitebeard Character (or a sub-8000 Luffy) must not match
                  // either branch. See cards/tests/OP16/001-portgas-d-ace.test.ts.
                  groups: [
                    [
                      { filter: "name", value: "Monkey.D.Luffy" },
                      { filter: "power", comparison: "gte", value: 8000 },
                    ],
                    [
                      { filter: "trait", value: ["Whitebeard Pirates", "Former Whitebeard Pirates", "Whitebeard Pirates Allies"], match: "includes" },
                      { filter: "power", comparison: "gte", value: 8000 },
                    ],
                  ],
                },
              ],
            },
            keyword: "rush",
            duration: "thisTurn",
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16PortgasDAce001I18n,
};
