import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op04ColorsTrap074,
  op04Spiderweb035,
  op10BlueGilly054,
  op15JustWatchMeAce021,
  op15Krieg001,
} from "@tcg/op-cards";

import { OnePieceTestEngine } from "../../../src/index.ts";

// The cost reduction counts Events in the trash while this card is still in HAND, so -- unlike
// OP15-095/OP15-097 -- the card does not count itself. Ruling #877 confirms 3 is not enough.
function withEventsInTrash(count: number, activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op15Krieg001,
      hand: [op15JustWatchMeAce021],
      activeDon,
      trash: [
        ...Array.from({ length: count }, (_, index) =>
          index % 2 === 0 ? op04Spiderweb035 : op04ColorsTrap074,
        ),
        // A non-Event in the trash must not count toward "4 or more Events".
        op02Atmos003,
      ],
    },
    { character: [op10BlueGilly054] },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

describe("OP15-021 Just Watch Me, Ace!!!", () => {
  test("with 4 Events in the trash the cost drops from 4 to 1", () => {
    const engine = withEventsInTrash(4, 1);

    engine.playCard(op15JustWatchMeAce021, "south");

    // Only 1 DON!! was available, so the play only succeeds at the reduced cost.
    expect(engine.getView("south").players.south.restedDon).toBe(1);
    expect(engine.getView("south").players.south.activeDon).toBe(0);
  });

  test("ruling #877: with only 3 Events in the trash the discount does not apply", () => {
    const engine = withEventsInTrash(3, 1);

    expect(
      engine.expectFailure({
        type: "playCard",
        seat: "south",
        instanceId: engine.findCardInZone("south", "hand", op15JustWatchMeAce021),
      }).reason,
    ).toBeTruthy();
    expect(engine.getView("south").players.south.activeDon).toBe(1);
  });

  test("[Main] gives an opponent Character -3000", () => {
    const engine = withEventsInTrash(4, 4);
    const blueGillyId = engine.findCardInZone("north", "character", op10BlueGilly054);

    engine.playCard(op15JustWatchMeAce021, "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [blueGillyId] }, "south");

    expect(
      engine
        .getView("north")
        .players.north.characters.find((card) => card?.instanceId === blueGillyId)?.power,
    ).toBe(2000);
  });

  test("[Counter] is a separate block and is usable during the opponent's attack", () => {
    // The [Main]/[Counter] pair is two blocks with identical actions; deleting the counter block
    // leaves this card out of the Counter candidates entirely and this goes red.
    const engine = OnePieceTestEngine.create(
      { leaderCardId: op15Krieg001, character: [{ card: op10BlueGilly054, playedOnTurn: 0 }] },
      {
        hand: [op15JustWatchMeAce021],
        activeDon: 4,
        trash: Array.from({ length: 4 }, () => op04Spiderweb035),
      },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const attackerId = engine.findCardInZone("south", "character", op10BlueGilly054);
    const counterId = engine.findCardInZone("north", "hand", op15JustWatchMeAce021);

    engine.declareAttack(attackerId, engine.leader("north"), "south");

    const counter = engine.pendingDecision("battleCounter", "north").steps[0];
    expect(counter?.kind).toBe("selectEntity");
    if (counter?.kind !== "selectEntity") throw new Error("Expected a Counter decision.");
    expect(counter.candidates.map((candidate) => candidate.ref.id)).toContain(counterId);
  });
});
