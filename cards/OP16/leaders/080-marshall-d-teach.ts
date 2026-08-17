import type { LeaderCard } from "@tcg/op-types";
import { op16MarshallDTeach080I18n } from "./080-marshall-d-teach.i18n.ts";

export const op16MarshallDTeach080: LeaderCard = {
  id: "OP16-080",
  canonicalId: "OP16-080",
  slug: "marshall-d-teach/op16-080",
  name: "Marshall.D.Teach",
  printings: [
    {
      id: "OP16-080",
      artId: "OP16-080",
      setCode: "OP16",
      collectorNumber: "080",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-080.png",
    },
  ],
  cardType: "leader",
  color: ["black", "yellow"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 4,
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  attribute: "special",
  effect:
    "[Opponent's Turn] All of your Characters gain +1 cost.\n[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card with a [Trigger] from your hand: Change the target of that attack to this Leader or to one of your [Blackbeard Pirates] type Character cards.",
  effects: {
    effects: [
      {
        // The bracketed [Trigger] in "trash 1 card with a [Trigger] from your hand" is a KEYWORD
        // REFERENCE to other cards' Trigger abilities, not a heading opening this card's own
        // Trigger box (CLAUDE.md; tools/import_cards.py's TRIGGER_HEADING_RE). This Leader has no
        // Trigger box at all -- `hasTrigger` is the filter that reads that property off another
        // card, and it accepts both a printed `trigger` string and an encoded `trigger:` block
        // (matchesTargetFilter, effects/targeting.ts).
        trigger: "onOpponentAttack",
        costs: [
          {
            cost: "trashFromHand",
            amount: 1,
            filters: [{ filter: "hasTrigger", value: true }],
          },
        ],
        actions: [
          {
            action: "changeBattleTarget",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1 },
              filters: [
                {
                  filter: "anyOf",
                  groups: [
                    // "this Leader" -- there is exactly one own Leader in the candidate pool, so
                    // cardCategory is how the redirect reaches it. Same shape and same printed
                    // phrasing as OP14-060 Donquixote Doflamingo.
                    [{ filter: "cardCategory", value: "leader" }],
                    [{ filter: "trait", value: "Blackbeard Pirates", match: "includes" }],
                  ],
                },
              ],
            },
          },
        ],
        optional: true,
        oncePerTurn: true,
      },
    ],
    permanentEffects: [
      {
        conditions: [{ condition: "turn", value: "opponent" }],
        actions: [
          {
            action: "modifyCost",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: "all" },
            },
            value: 1,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op16MarshallDTeach080I18n,
};
