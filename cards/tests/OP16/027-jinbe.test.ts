import { describe, expect, test } from "vite-plus/test";
import { op16Jinbe027 } from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

function jinbePower(engine: OnePieceTestEngine, instanceId: string): number {
  const card = engine
    .getView("south")
    .players.south.characters.find((entry) => entry?.instanceId === instanceId);
  if (!card || card.power === null) throw new Error("Jinbe is not on the field.");
  return card.power;
}

describe("OP16-027 Jinbe", () => {
  test("with 1 DON!! given, power is exactly 5000 -- 2000 base + 1000 for the DON!! + 2000 from the effect", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Jinbe027, attachedDon: 1 }] },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const jinbeId = engine.findCardInZone("south", "character", op16Jinbe027);

    // The magnitude is asserted as an exact number, not as "boosted": a candidate list or a
    // "power went up" check survives value: 2000 -> 1000 (cards/ENCODING.md, rule 1).
    expect(jinbePower(engine, jinbeId)).toBe(5000);
  });

  test("with 0 DON!! given, power is its printed 2000 -- the DON!! x1 gate is real", () => {
    const engine = OnePieceTestEngine.create(
      { character: [op16Jinbe027] },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const jinbeId = engine.findCardInZone("south", "character", op16Jinbe027);

    expect(jinbePower(engine, jinbeId)).toBe(2000);
  });

  test("the +2000 survives into the opponent's turn -- the print carries no [Your Turn] tag", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Jinbe027, attachedDon: 1 }] },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const jinbeId = engine.findCardInZone("south", "character", op16Jinbe027);

    engine.endTurn("south");

    // getCardPower (shared.ts) only counts attached DON!! while its controller is the active
    // seat, so the DON!!'s own +1000 drops off here; the card's own +2000 must not.
    expect(jinbePower(engine, jinbeId)).toBe(4000);
  });
});
