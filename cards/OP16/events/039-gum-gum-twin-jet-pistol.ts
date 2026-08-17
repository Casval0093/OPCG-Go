import type { EventCard } from "@tcg/op-types";
import { op16GumGumTwinJetPistol039I18n } from "./039-gum-gum-twin-jet-pistol.i18n.ts";

export const op16GumGumTwinJetPistol039: EventCard = {
  id: "OP16-039",
  canonicalId: "OP16-039",
  slug: "gum-gum-twin-jet-pistol/op16-039",
  name: "Gum-Gum Twin Jet Pistol",
  printings: [
    {
      id: "OP16-039",
      artId: "OP16-039",
      setCode: "OP16",
      collectorNumber: "039",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-039.png",
    },
  ],
  cardType: "event",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  trigger: "Rest your opponent's Leader.",
  traits: ["Impel Down", "Straw Hat Crew"],
  effect:
    "[Main] Up to 1 of your [Monkey.D.Luffy] cards gains [Double Attack] during this turn. Then, if your Leader has the [Impel Down] type, rest up to 2 of your opponent's Characters with a cost of 3 or less.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "grantKeyword",
            target: {
              player: "self",
              // "your [Monkey.D.Luffy] CARDS", not Characters: OP16-022 is itself a Leader named
              // Monkey.D.Luffy, so the Leader is a legal recipient.
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Monkey.D.Luffy" }],
            },
            keyword: "doubleAttack",
            duration: "thisTurn",
          },
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 2, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 3 }],
            },
            // The Leader check is written into the LATER sentence ("Then, if your Leader has the
            // [Impel Down] type, rest ..."), so it gates only this action and not the Double
            // Attack grant -- the OP15-056/#899 side of the split, not the OP15-116/#944 side
            // (cards/ENCODING.md).
            condition: { condition: "leaderTrait", trait: "Impel Down", match: "includes" },
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "rest",
            target: { player: "opponent", zones: ["leader"], count: { amount: 1 } },
          },
        ],
      },
    ],
  },
  i18n: op16GumGumTwinJetPistol039I18n,
};
