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
  i18n: op15TheRiskyBrothers093I18n,
};
