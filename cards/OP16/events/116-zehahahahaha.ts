import type { EventCard } from "@tcg/op-types";
import { op16Zehahahahaha116I18n } from "./116-zehahahahaha.i18n.ts";

export const op16Zehahahahaha116: EventCard = {
  id: "OP16-116",
  canonicalId: "OP16-116",
  slug: "zehahahahaha/op16-116",
  name: "Zehahahahaha!",
  printings: [
    {
      id: "OP16-116",
      artId: "OP16-116",
      setCode: "OP16",
      collectorNumber: "116",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-116.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  trigger: "Draw 2 cards and trash 1 card from your hand.",
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  effect:
    "[Main] If you have 10 DON!! cards on your field, play up to 1 [Marshall.D.Teach] from your hand. Then, add up to 1 card from the top of your opponent's Life cards to the owner's hand.",
  effects: {
    effects: [
      {
        trigger: "main",
        // The DON!! check leads the sentence, so it gates the whole block -- including the "Then"
        // half (cards/ENCODING.md, Task 4). `eq`, not `gte`: that is how every existing "If you
        // have 10 DON!! cards on your field" in the engine is written (OP01-091 King,
        // OP05-040 Birdcage, OP05-062 O-Nami, OP05-066 Jinbe, OP08-059 Alber).
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "eq", value: 10 }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "name", value: "Marshall.D.Teach" }],
          },
          // Ruling #1015: with the opponent at 0 Life the [Main] may still be used to play
          // Marshall.D.Teach (可以). These are two independent actions in sequence rather than
          // `thenActions` on the play, so neither half can gate the other in either direction.
          {
            action: "removeFromLife",
            player: "opponent",
            count: { amount: 1, upTo: true },
            destination: "hand",
            position: "top",
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          { action: "draw", player: "self", amount: 2 },
          { action: "trashFromHand", player: "self", amount: 1 },
        ],
      },
    ],
  },
  i18n: op16Zehahahahaha116I18n,
};
