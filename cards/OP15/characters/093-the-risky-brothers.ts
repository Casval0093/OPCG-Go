import type { CharacterCard } from "@tcg/op-types";
import { op15TheRiskyBrothers093I18n } from "./093-the-risky-brothers.i18n.ts";

export const op15TheRiskyBrothers093: CharacterCard = {
  id: "OP15-093",
  canonicalId: "OP15-093",
  slug: "the-risky-brothers/op15-093",
  name: "The Risky Brothers",
  printings: [
    {
      id: "OP15-093",
      artId: "OP15-093",
      setCode: "OP15",
      collectorNumber: "093",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-093.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Rolling Pirates"],
  attribute: "slash",
  effect:
    "[Activate: Main] You may trash this Character: If you have 15 or more cards in your trash, up to 1 of your [Monkey.D.Luffy] Characters gains [Rush: Character] and the &lt;Slash&gt; attribute during this turn.",
  // PARKED -- "and the <Slash> attribute" (和属性（斩）) is NOT encoded. There is no
  // attribute-granting Action in the DSL at all: `attribute` appears only as a TargetFilter and
  // as `leaderAttribute`, a Condition. Nothing reads a granted attribute either, so this is a
  // new missing primitive rather than an instance of a registered one. It matters in real play
  // because attribute is what cards keying on <Slash>/<Strike> read. The [Rush: Character]
  // half IS encoded and tested.
  effects: {
    effects: [
      {
        // Ruling #928, the twin of OP15-083 Spoil's #923: at 14 cards in the trash this works
        // (可以), because trashing this Character to pay the cost is the 15th. So the count must
        // sit on the ACTION -- `block.conditions` are evaluated before `payCosts`, both at the
        // command and again at the head of `processQueuedEffectBlock`.
        trigger: "activateMain",
        costs: [{ cost: "trashThisCard" }],
        actions: [
          {
            action: "grantKeyword",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              // A bracketed proper noun: the card NAME "Monkey.D.Luffy". There is no
              // Monkey.D.Luffy *trait*.
              filters: [{ filter: "name", value: "Monkey.D.Luffy" }],
            },
            // [Rush: Character] is its own Keyword value, distinct from `rush`: it permits
            // attacking Characters on the turn played but still not the Leader (OP16-089).
            keyword: "rushCharacter",
            duration: "thisTurn",
            condition: {
              condition: "zoneCount",
              player: "self",
              zone: "trash",
              comparison: "gte",
              value: 15,
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15TheRiskyBrothers093I18n,
};
