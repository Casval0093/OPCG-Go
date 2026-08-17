import type { EventCard } from "@tcg/op-types";
import { op15GumGumGoldenRifle116I18n } from "./116-gum-gum-golden-rifle.i18n.ts";

export const op15GumGumGoldenRifle116: EventCard = {
  id: "OP15-116",
  canonicalId: "OP15-116",
  slug: "gum-gum-golden-rifle/op15-116",
  name: "Gum-Gum Golden Rifle",
  printings: [
    {
      id: "OP15-116",
      artId: "OP15-116",
      setCode: "OP15",
      collectorNumber: "116",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-116.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  traits: ["Sky Island", "Straw Hat Crew"],
  effect:
    "[Main] If your Leader has the [Straw Hat Crew] type, trash 1 card from the top of your Life cards. Then, add up to 1 card from the top of your deck to the top of your Life cards and trash 1 card from your hand.\n[Counter] Your Leader gains +4000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        // Ruling #944 puts the [Straw Hat Crew] check on the BLOCK, not just the first sentence:
        // without the type you cannot do the "Then, ..." half either (不可以). Compare OP15-056, where
        // ruling #899 places an apparently similar check on individual actions instead -- the
        // difference is that a leading "If your Leader ..." gates everything, while a check written
        // into the second sentence's target only qualifies that target. Read the ruling per card.
        conditions: [{ condition: "leaderTrait", trait: "Straw Hat Crew", match: "includes" }],
        actions: [
          { action: "removeFromLife", player: "self", count: { amount: 1 }, destination: "trash" },
          // Ruling #943: this still resolves with 0 Life or 0 hand cards.
          {
            action: "addToLife",
            target: { player: "self", zones: ["deck"], count: { amount: 1, upTo: true } },
            position: "top",
          },
          { action: "trashFromHand", player: "self", amount: 1 },
        ],
      },
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 4000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op15GumGumGoldenRifle116I18n,
};
