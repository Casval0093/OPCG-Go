import { describe, expect, test } from "vite-plus/test";
import type { CharacterCard } from "@tcg/op-types";
import {
  op01MonkeyDLuffy003,
  op02Atmos003,
  op03Namule007,
  op15TheRiskyBrothers093,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// There is no vanilla Character named "Monkey.D.Luffy" anywhere in OP01-OP14/EB/PRB/ST01, so the
// grant target has to be synthetic. Both name fields must be overridden: the `name` TargetFilter
// resolves through `cardName()`, which reads `i18n.en.name`, not the top-level `name`.
const luffyBody: CharacterCard = {
  ...op02Atmos003,
  id: "TEST-OP15-093-LUFFY",
  canonicalId: "TEST-OP15-093-LUFFY",
  name: "Monkey.D.Luffy",
  i18n: { en: { ...op02Atmos003.i18n.en, name: "Monkey.D.Luffy" } },
};

registerCards([luffyBody]);

function riskyWithTrash(trash: number) {
  return OnePieceTestEngine.create(
    {
      leaderCardId: op01MonkeyDLuffy003,
      character: [{ card: op15TheRiskyBrothers093, playedOnTurn: 0 }],
      // op03Namule007 is the "wrong name" control -- a Character on the same field, right about
      // everything except its name.
      hand: [luffyBody, op03Namule007],
      trash,
      deck: 10,
      activeDon: 10,
    },
    { character: [{ card: op03Namule007, rested: true, playedOnTurn: 0 }], deck: 10 },
    { firstPlayer: "north", activeSeat: "south" },
  );
}

function activateRisky(engine: OnePieceTestEngine) {
  engine.exec({
    type: "activateEffect",
    seat: "south",
    sourceInstanceId: engine.findCardInZone("south", "character", op15TheRiskyBrothers093),
    trigger: "activateMain",
  });
  engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");
}

describe("OP15-093 The Risky Brothers", () => {
  test("ruling #928: at 14 cards in the trash it works, and grants [Rush: Character]", () => {
    // 可以 -- trashing this Character to pay the cost is the 15th card, so the count has to sit
    // on the ACTION. On `block.conditions` the activation would be refused outright here.
    const engine = riskyWithTrash(14);

    engine.playCard(luffyBody, "south");
    engine.playCard(op03Namule007, "south");
    const luffyId = engine.findCardInZone("south", "character", luffyBody);
    const namuleId = engine.findCardInZone("south", "character", op03Namule007);

    activateRisky(engine);

    expect(engine.getState().players.south.trash).toHaveLength(15);

    const step = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    if (step?.kind !== "selectEntity") throw new Error("Expected the keyword grant target.");
    const candidateIds = step.candidates.map((candidate) => candidate.ref.id);
    expect(candidateIds).toEqual([luffyId]);
    expect(candidateIds).not.toContain(namuleId);

    engine.resolveDecision("effectTargetSelection", { selectedIds: [luffyId] }, "south");

    // [Rush: Character] is not [Rush]: it permits attacking a Character on the turn played and
    // still forbids the Leader. Prove both directions on the same body -- the Leader attack
    // first, because a successful attack rests the attacker.
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: luffyId,
        targetId: engine.leader("north"),
      }).accepted,
    ).toBe(false);

    engine.declareAttack(
      luffyId,
      engine.findCardInZone("north", "character", op03Namule007),
      "south",
    );

    expect(engine.getState().cards[luffyId]?.rested).toBe(true);
  });

  test("at 13 cards the cost is paid and no keyword is granted", () => {
    // 14 after the cost. Also the only case that kills `comparison gte -> lte`: under `lte 15`
    // a 14-card trash would grant, and this prompt would exist.
    const engine = riskyWithTrash(13);
    const riskyId = engine.findCardInZone("south", "character", op15TheRiskyBrothers093);

    engine.playCard(luffyBody, "south");
    const luffyId = engine.findCardInZone("south", "character", luffyBody);

    activateRisky(engine);

    const state = engine.getState();
    expect(state.cards[riskyId]?.zone).toBe("trash");
    expect(state.players.south.trash).toHaveLength(14);
    expect(
      state.promptQueue.filter(
        (prompt) =>
          prompt.status === "pending" &&
          prompt.resolutionContext?.intent === "effectTargetSelection",
      ),
    ).toHaveLength(0);

    // Without the grant the freshly played body cannot attack anything at all.
    expect(
      engine.expectFailure({
        type: "declareAttack",
        seat: "south",
        attackerId: luffyId,
        targetId: engine.findCardInZone("north", "character", op03Namule007),
      }).accepted,
    ).toBe(false);
  });
});
