import type { CharacterCard } from "@tcg/op-types";
import { op16Magellan074I18n } from "./074-magellan.i18n.ts";

export const op16Magellan074: CharacterCard = {
  id: "OP16-074",
  canonicalId: "OP16-074",
  slug: "magellan/op16-074",
  name: "Magellan",
  printings: [
    {
      id: "OP16-074",
      artId: "OP16-074",
      setCode: "OP16",
      collectorNumber: "074",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-074.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP16",
  cost: 8,
  power: 10000,
  traits: ["Impel Down"],
  attribute: "special",
  effect:
    "[On Play] If your Leader has the [Impel Down] type, your opponent returns 1 DON!! card from their field to their DON!! deck.\n[On K.O.] Your opponent returns 4 DON!! cards from their field to their DON!! deck.",
  effects: {
    effects: [
      {
        // Ruling #999: the DON!!'s owner — the opponent — chooses which cards go back. That is
        // what `opponentReturnDon` does natively (effects/actions.ts prompts `returningSeat`,
        // intent `effectOpponentReturnDon`), so it needs no `chosenBy`. This is the first card
        // in the engine to use the action at all.
        // Leading "If your Leader ..." gates the block (ruling #944's shape, OP15-116).
        trigger: "onPlay",
        conditions: [{ condition: "leaderTrait", trait: "Impel Down", match: "includes" }],
        actions: [{ action: "opponentReturnDon", amount: 1 }],
      },
      {
        // The [On K.O.] half carries NO Leader condition on the print — do not add one by
        // analogy with the [On Play] half.
        trigger: "onKo",
        actions: [{ action: "opponentReturnDon", amount: 4 }],
      },
    ],
  },
  i18n: op16Magellan074I18n,
};
