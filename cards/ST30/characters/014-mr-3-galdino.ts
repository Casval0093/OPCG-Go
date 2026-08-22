import type { CharacterCard } from "@tcg/op-types";
import { st30Mr3Galdino014I18n } from "./014-mr-3-galdino.i18n.ts";

export const st30Mr3Galdino014: CharacterCard = {
  id: "ST30-014",
  canonicalId: "ST30-014",
  slug: "mr-3-galdino/st30-014",
  name: "Mr.3(Galdino)",
  printings: [
    {
      id: "ST30-014",
      artId: "ST30-014",
      setCode: "ST30",
      collectorNumber: "014",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/ST30-014.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "ST30",
  cost: 2,
  power: 3000,
  counter: 2000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: Give up to 2 of your Characters with 6000 base power up to 2 rested DON!! cards each.",
  // PARKED -- the whole [Activate: Main] is NOT encoded. `giveDon` `distribution: "each"`
  // attaches `count.amount` exactly (effects/actions.ts) and never reads `count.upTo`.
  // `count.upTo` is only the single-target `effectGiveDonCount` path, so
  // `{ amount: 2, upTo: true }` is one shared 0..2 for one body, not 0..2 independently
  // per selected Character. Encoding `{ amount: 2 }` each would fire exactly 2 and call
  // that encoded. restThis, own-side giveDon (not giveDonSourcePlayer), and
  // `basePower eq 6000` (ruling #255) are all expressible; the miss is the per-target
  // magnitude. Primitive: `giveDonPerTargetUpTo` in data/parked-clauses.json.
  i18n: st30Mr3Galdino014I18n,
};
