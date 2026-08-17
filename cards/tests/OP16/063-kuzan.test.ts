import { describe, expect, test } from "vite-plus/test";
import { op02Smoker093, op03Namule007, op04Ideo077, op16Kuzan063 } from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

// op04Ideo077 is a printed [Blocker] and nothing else; op03Namule007 is genuinely vanilla, so it
// is the "has no [Blocker]" body ruling #996 turns on. op02Smoker093's own ability is
// [DON!! x1] [Activate: Main], so it never fires on its own and cannot disturb these boards.
const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function kuzanOnField(activeDon: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op02Smoker093,
      character: [{ card: op16Kuzan063, playedOnTurn: 0 }],
      activeDon,
    },
    { character: [op04Ideo077, op03Namule007] },
    SOUTH_ACTS,
  );
}

describe("OP16-063 Kuzan", () => {
  test("[On Play] adds up to 2 DON!! from the DON!! deck RESTED", () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: op02Smoker093,
        hand: [op16Kuzan063],
        activeDon: op16Kuzan063.cost,
        // 5 in the DON!! deck, so the cap in the offer below comes from the printed "up to 2"
        // rather than from an exhausted DON!! deck.
        donDeckCount: 5,
      },
      {},
    );

    engine.playCard(op16Kuzan063, "south");

    const howMany = engine.pendingDecision("effectAddDon", "south").steps[0];
    if (howMany?.kind !== "chooseOption") throw new Error("Expected Kuzan's DON!! count choice.");
    expect(howMany.options.map((option) => option.id)).toEqual(["0", "1", "2"]);
    engine.resolveDecision("effectAddDon", { optionId: "2" }, "south");

    const view = engine.getView("south");
    // The 7 spent paying for Kuzan are rested too, so restedDon is 7 + 2. What matters is that
    // activeDon stays 0: `state: "rested"` mutated to "active" would put 2 there.
    expect(view.players.south).toMatchObject({ activeDon: 0, restedDon: 9, donDeckCount: 3 });
    expect(view.prompts).toHaveLength(0);
  });

  test("ruling #996: an opponent Character WITHOUT [Blocker] is a legal target", () => {
    const engine = kuzanOnField(1);
    const kuzanId = engine.findCardInZone("south", "character", op16Kuzan063);
    const ideoId = engine.findCardInZone("north", "character", op04Ideo077);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(kuzanId, "activateMain", "south");

    const choice = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (choice?.kind !== "selectEntity") throw new Error("Expected Kuzan's [Blocker] lock target.");
    expect(choice).toMatchObject({ min: 0, max: 1 });
    // Ruling #996 says yes (可以) to a Character that has no [Blocker] at all, which is what
    // forbids `requiresKeyword: true` or a `hasKeyword` filter on this action.
    expect(choice.candidates.map((candidate) => candidate.ref.id).sort()).toEqual(
      [ideoId, namuleId].sort(),
    );
    // "your opponent's Characters": not their Leader, and not Kuzan's own side.
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(
      engine.leader("north"),
    );
    expect(choice.candidates.map((candidate) => candidate.ref.id)).not.toContain(kuzanId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [ideoId] }, "south");
    // DON!! -1 is a returnDon cost, so the DON!! leaves the field entirely rather than resting.
    expect(engine.getView("south").players.south).toMatchObject({ activeDon: 0, restedDon: 0 });

    engine.declareAttack(kuzanId, engine.leader("north"), "south");

    // Ideo is still an untouched active [Blocker]; the only reason no blocker step opened is the
    // lock. north's hand is empty, so nothing else could be prompting here either.
    expect(engine.getState().cards[ideoId]?.rested).toBe(false);
    expect(engine.getView("north").prompts).toHaveLength(0);
  });

  test("the lock binds to the SELECTED Character only -- naming the other one still lets Ideo block", () => {
    // The control for the test above: same board, same activation, different target. Without it
    // "no blocker prompt" would be indistinguishable from a broken fixture.
    const engine = kuzanOnField(1);
    const kuzanId = engine.findCardInZone("south", "character", op16Kuzan063);
    const ideoId = engine.findCardInZone("north", "character", op04Ideo077);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);

    engine.activateEffect(kuzanId, "activateMain", "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");
    engine.declareAttack(kuzanId, engine.leader("north"), "south");

    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Ideo's blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(ideoId);
  });

  test("[Once Per Turn]: a second activation is not offered even with DON!! to spare", () => {
    // 2 active DON!! means the DON!! -1 cost is still payable after the first use, so the only
    // thing that can remove the command is `oncePerTurn`.
    const engine = kuzanOnField(2);
    const kuzanId = engine.findCardInZone("south", "character", op16Kuzan063);
    const namuleId = engine.findCardInZone("north", "character", op03Namule007);

    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === kuzanId,
      ),
    ).toBe(true);

    engine.activateEffect(kuzanId, "activateMain", "south");
    engine.resolveDecision("effectTargetSelection", { selectedIds: [namuleId] }, "south");

    expect(engine.getView("south").players.south.activeDon).toBe(1);
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "activateEffect" && command.sourceId === kuzanId,
      ),
    ).toBe(false);
  });
});
