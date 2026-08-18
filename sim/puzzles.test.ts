// Policy-quality measurement, step 2 of the plan in CLAUDE.md: the PUZZLE SUITE.
//
//   ./scripts/simulate.sh --puzzles
//
// The dominance ladder (step 1) can only order policies against each other. It cannot say whether
// the best of them plays WELL -- being best of five weak heuristics is not evidence of strength.
// A puzzle has a single defensible answer, so the score is absolute: no opponent, no statistics,
// and a failure names the decision class that is broken instead of moving a win rate.
//
// EVERY PUZZLE IS GUARDED, because a puzzle that cannot fail is worse than no puzzle:
//   * SOLVABLE  -- at least one legal command satisfies the answer, else the position is broken
//   * DISCRIMINATING -- at least one legal command does NOT, else the puzzle is vacuous
// Both are asserted at run time and reported per puzzle. A suite that every policy passes is
// measuring nothing, so the whole ladder is run against it and the pass count per puzzle is printed:
// if `random` solves it, the puzzle is too easy to be diagnostic.
//
// The two classes here were verified against engine source before any puzzle was written, rather
// than from memory of the paper rules:
//   * lethal  -- battle.ts: `if (defender.life.length === 0)` and the attack connects => winner is
//     the attacker. So lethal means 0 life cards plus an attack that reaches.
//   * futile  -- battle.ts: `if (battle.attackPower >= battle.defensePower)` gates ALL damage, and
//     the else branch does nothing to the attacker. There is no mutual destruction in this game, so
//     "suicide attack" is not a real class; the real error is spending an attack on a body you
//     cannot beat when a productive attack exists.

import { test } from "vite-plus/test";
import { allCards } from "@tcg/op-cards";
import { getLegalCommands } from "../../src/core.ts";
import {
  valueRankedStrategy,
  greedyStrategy,
  randomStrategy,
  firstLegalStrategy,
  passOnlyStrategy,
} from "../../src/automation/bot-strategies.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";
import { OnePieceTestEngine } from "../../src/index.ts";
import type { EngineCommand, MatchSeat, MatchState } from "../../src/types.ts";

const run = process.env.SIM_PUZZLES === "1" ? test : test.skip;

// Strongest first, so the headline column is the policy the sim actually uses.
const LADDER: Array<[string, OnePieceBotStrategy]> = [
  ["valueRanked", valueRankedStrategy],
  ["greedy", greedyStrategy],
  ["firstLegal", firstLegalStrategy],
  ["random", randomStrategy],
  ["passOnly", passOnlyStrategy],
];

// Vanilla bodies with no effects text, so a puzzle's answer turns only on power and board state.
const LEADER = "OP01-001"; // Roronoa.Zoro, 5000
const P4000 = "OP01-012"; // Sai
const P6000 = "OP01-018"; // Hajrudin
const P8000 = "OP01-110"; // Fukurokuju
const P10000 = "OP05-044"; // John Giant

interface Puzzle {
  id: string;
  klass: "lethal" | "futile";
  /** Why exactly one family of answers is defensible. Prose, for the failure report. */
  why: string;
  build: () => OnePieceTestEngine;
  /** True when `cmd` is a defensible answer in `state`. */
  answer: (cmd: EngineCommand, state: MatchState, e: OnePieceTestEngine) => boolean;
}

const SEAT: MatchSeat = "south";

// `firstPlayer` is NORTH deliberately. canAttackWith() has
//   if (state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer) return false;
// -- the first player may not attack on their own first turn. Seating south as the first player
// makes every attack illegal on turn 1, which silently turns an attack puzzle into a position whose
// only legal command is endTurn. The suite's SOLVABLE guard caught exactly that on the first run;
// without it this would have been reported as the policy failing five lethal puzzles.
function board(south: object, north: object): OnePieceTestEngine {
  return OnePieceTestEngine.create(
    { leaderCardId: LEADER, deck: 20, ...south },
    { leaderCardId: LEADER, deck: 20, ...north },
    { activeSeat: SEAT, firstPlayer: "north" },
  );
}

/** A declareAttack whose target is the opponent's leader. */
function hitsLeader(cmd: EngineCommand, state: MatchState): boolean {
  if (cmd.type !== "declareAttack") return false;
  return state.cards[cmd.targetId]?.zone === "leader";
}

/** The concrete commands a seat could actually submit, expanded from the legal descriptors. */
function concrete(state: MatchState, seat: MatchSeat): EngineCommand[] {
  const out: EngineCommand[] = [];
  for (const d of getLegalCommands(state, seat)) {
    if (d.type === "declareAttack" && d.sourceId && d.targetIds?.length) {
      for (const targetId of d.targetIds) {
        out.push({
          type: "declareAttack",
          seat,
          attackerId: d.sourceId,
          targetId,
        } as EngineCommand);
      }
    } else if (d.type === "endTurn") {
      out.push({ type: "endTurn", seat } as EngineCommand);
    }
  }
  return out;
}

const PUZZLES: Puzzle[] = [
  {
    id: "lethal-bare",
    klass: "lethal",
    why: "North is on 0 life with an empty board; a 6000 body reaches a 5000 leader, so attacking it wins outright. Ending the turn throws the game away.",
    build: () => board({ character: [{ cardId: P6000, playedOnTurn: 0 }] }, { life: 0 }),
    answer: hitsLeader,
  },
  {
    id: "lethal-decoy-body",
    klass: "lethal",
    why: "Same lethal, but a rested 4000 sits there as bait. K.O.ing it is a real play that accomplishes nothing; only the leader attack wins.",
    build: () =>
      board(
        { character: [{ cardId: P6000, playedOnTurn: 0 }] },
        { life: 0, character: [{ cardId: P4000, rested: true, playedOnTurn: 0 }] },
      ),
    answer: hitsLeader,
  },
  {
    id: "lethal-pick-the-attacker",
    klass: "lethal",
    why: "Two attackers, one lethal: 8000 reaches the 5000 leader, 4000 does not (attackPower >= defensePower fails, so it is a whiff). Winning requires choosing the right body.",
    build: () =>
      board(
        {
          character: [
            { cardId: P4000, playedOnTurn: 0 },
            { cardId: P8000, playedOnTurn: 0 },
          ],
        },
        { life: 0 },
      ),
    answer: (cmd, state, e) =>
      hitsLeader(cmd, state) &&
      cmd.type === "declareAttack" &&
      state.cards[cmd.attackerId]?.cardId === P8000 &&
      e !== undefined,
  },
  {
    id: "futile-unbeatable-body",
    klass: "futile",
    why: "A 6000 cannot dent a rested 10000, and attacking it only rests the attacker. The 5000 leader is reachable for real damage, so the leader attack strictly dominates both the futile swing and passing.",
    build: () =>
      board(
        { character: [{ cardId: P6000, playedOnTurn: 0 }] },
        { life: 2, character: [{ cardId: P10000, rested: true, playedOnTurn: 0 }] },
      ),
    answer: hitsLeader,
  },
  {
    id: "futile-pick-any-productive",
    klass: "futile",
    why: "An 8000 can K.O. the rested 4000 or damage the 5000 leader; both are defensible and no preference is asserted. It cannot beat the rested 10000, so only that swing is wrong.",
    build: () =>
      board(
        { character: [{ cardId: P8000, playedOnTurn: 0 }] },
        {
          life: 3,
          character: [
            { cardId: P4000, rested: true, playedOnTurn: 0 },
            { cardId: P10000, rested: true, playedOnTurn: 0 },
          ],
        },
      ),
    answer: (cmd, state) => {
      if (cmd.type !== "declareAttack") return false;
      return state.cards[cmd.targetId]?.cardId !== P10000;
    },
  },
];

run("puzzles", () => {
  if (allCards.length === 0) throw new Error("card registry empty");
  const names = LADDER.map(([n]) => n);
  console.log(
    `\nPUZZLES  ${PUZZLES.length} positions  catalog=${allCards.length}\n` +
      `${"".padEnd(30)}${names.map((n) => n.slice(0, 11).padStart(12)).join("")}   guards`,
  );

  const failures: string[] = [];
  const byClass = new Map<string, { n: number; ok: number }>();

  for (const p of PUZZLES) {
    const engine = p.build();
    const state = engine.getState();
    const options = concrete(state, SEAT);
    const solvable = options.filter((c) => p.answer(c, state, engine)).length;
    const wrong = options.length - solvable;

    // A puzzle that cannot be failed, or cannot be solved, is a defect in the SUITE.
    if (solvable === 0) failures.push(`${p.id}: BROKEN — no legal command satisfies the answer`);
    if (wrong === 0) failures.push(`${p.id}: VACUOUS — every legal command satisfies the answer`);

    const cells: string[] = [];
    for (const [name, strategy] of LADDER) {
      const fresh = p.build();
      const s = fresh.getState();
      const cmd = strategy(s, SEAT, getLegalCommands(s, SEAT));
      const ok = cmd !== null && p.answer(cmd, s, fresh);
      cells.push((ok ? "pass" : "FAIL").padStart(12));
      if (name === "valueRanked") {
        const agg = byClass.get(p.klass) ?? { n: 0, ok: 0 };
        agg.n += 1;
        if (ok) agg.ok += 1;
        byClass.set(p.klass, agg);
      }
    }
    console.log(
      `${p.id.padEnd(30)}${cells.join("")}   ${solvable}/${options.length} correct of legal`,
    );
  }

  console.log("\nvalueRanked by decision class:");
  for (const [klass, agg] of byClass) {
    console.log(`  ${klass.padEnd(10)} ${agg.ok}/${agg.n}`);
  }

  if (failures.length) {
    console.log("\nSUITE DEFECTS (these are bugs in the puzzles, not in the policy):");
    for (const f of failures) console.log(`  ${f}`);
    throw new Error(`${failures.length} puzzle(s) are broken or vacuous`);
  }
});
