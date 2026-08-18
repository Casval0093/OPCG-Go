import { describe, expect, test } from "vite-plus/test";
import { eb01Hannyabal021, op05JohnGiant044, op16Magellan074 } from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

// eb01Hannyabal021 has the [Impel Down] type and only an [End of Your Turn] ability, which no
// test here reaches. The default Leader (OP13-001, "Straw Hat Crew Supernovas") is the control.
// The opponent is always given BOTH active and rested DON!! on purpose: `opponentReturnDon` only
// publishes a choice when more than one KIND of DON!! source exists, and a silent auto-return
// would leave ruling #999 (the owner chooses) unasserted.
function magellanInHand(leaderCardId: PlayerFixture["leaderCardId"]) {
  return OnePieceTestEngine.create(
    { leaderCardId, hand: [op16Magellan074], activeDon: op16Magellan074.cost },
    { activeDon: 2, restedDon: 2, donDeckCount: 6 },
  );
}

describe("OP16-074 Magellan", () => {
  test("[On Play] with an [Impel Down] Leader returns exactly 1 of the opponent's DON!!", () => {
    const engine = magellanInHand(eb01Hannyabal021);

    engine.playCard(op16Magellan074, "south");

    // Ruling #999: the choice belongs to the DON!!'s owner, so the prompt is north's, not the
    // effect controller's. `opponentReturnDon` does that natively -- it seats the prompt on the
    // returning player.
    const pay = engine.pendingDecision("effectOpponentReturnDon", "north").steps[0];
    if (pay?.kind !== "payCost") throw new Error("Expected north to choose their own DON!!.");
    // Exactly 1 out of the 4 on north's field: this pins `amount: 1`.
    expect(pay).toMatchObject({ min: 1, max: 1 });
    expect(pay.candidates).toHaveLength(4);
    expect(() => engine.pendingDecision("effectOpponentReturnDon", "south")).toThrow();

    // Candidates are DON!!-slot ids, active first then rested; index 3 is the second rested one.
    engine.resolveDecision(
      "effectOpponentReturnDon",
      { selectedIds: [pay.candidates[3]!.ref.id] },
      "north",
    );

    const view = engine.getView("north");
    // The rested one was chosen, so it is rested DON!! that dropped -- north picked, not south.
    expect(view.players.north).toMatchObject({ activeDon: 2, restedDon: 1, donDeckCount: 7 });
    expect(view.prompts).toHaveLength(0);
  });

  test("[On Play] without an [Impel Down] Leader nothing is returned", () => {
    const engine = magellanInHand(undefined);

    engine.playCard(op16Magellan074, "south");

    const view = engine.getView("north");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.north).toMatchObject({ activeDon: 2, restedDon: 2, donDeckCount: 6 });
  });

  test("[On K.O.] returns 4 of the opponent's DON!!, with no Leader condition at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        // Not an [Impel Down] Leader: the [On K.O.] half prints no condition, so it fires anyway.
        character: [{ card: op05JohnGiant044, playedOnTurn: 0 }],
        activeDon: 3,
        restedDon: 2,
        donDeckCount: 5,
      },
      // north's hand is empty, so no counter step interrupts the K.O.
      { character: [{ card: op16Magellan074, rested: true }] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const magellanId = engine.findCardInZone("north", "character", op16Magellan074);

    // 10000 into Magellan's 10000: attackPower >= defensePower is a hit.
    engine.declareAttack(
      engine.findCardInZone("south", "character", op05JohnGiant044),
      magellanId,
      "south",
    );

    // south is now the returning seat, so south gets the prompt even though north owns Magellan.
    const pay = engine.pendingDecision("effectOpponentReturnDon", "south").steps[0];
    if (pay?.kind !== "payCost") throw new Error("Expected south to choose 4 of their own DON!!.");
    // 4, not 1: the two halves of this card print different magnitudes and neither is probed by
    // the mutation checker, which only perturbs `value:` literals of 3+ digits.
    expect(pay).toMatchObject({ min: 4, max: 4 });
    expect(pay.candidates).toHaveLength(5);
    engine.resolveDecision(
      "effectOpponentReturnDon",
      { selectedIds: pay.candidates.slice(0, 4).map((candidate) => candidate.ref.id) },
      "south",
    );

    const view = engine.getView("south");
    // 5 DON!! on the field, 4 gone.
    expect(view.players.south.activeDon + view.players.south.restedDon).toBe(1);
    expect(view.players.south.donDeckCount).toBe(9);
    expect(engine.getState().cards[magellanId]?.zone).toBe("trash");
  });
});
