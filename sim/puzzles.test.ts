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
import { applyCommand, getLegalCommands } from "../../src/core.ts";
import {
  valueRankedStrategy,
  greedyStrategy,
  randomStrategy,
  firstLegalStrategy,
  passOnlyStrategy,
} from "../../src/automation/bot-strategies.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";
import { resolveBotPromptCommand } from "../../src/automation/bot-harness.ts";
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
  /** Baseline for `valueRanked`, asserted. Set "fail" only for a puzzle it is known not to solve. */
  expect: "pass" | "fail";
}

const SEAT: MatchSeat = "south";
const OPP: MatchSeat = "north";

// Batch 2 Task 1: a puzzle spanning a whole turn (sequencing; DON!! attach-then-attack) needs its
// candidate answer to be a LINE of several commands, not just one, and needs the position to
// survive a prompt any command in that line might open. `adjudicate` below accepts either a single
// command (all 6 original puzzles) or an explicit array -- a bare command is treated as a
// one-command line, so the original puzzles are scored byte-identically to before.
//
// Per the "Architectural fact" in docs/plans/policy-puzzle-batch-2.md, a prompt opened mid-line (a
// defender's counter, a search order) is owned by resolveBotPromptCommand, NEVER by the strategy
// under test -- and the engine rejects the line's next command outright while one is pending. So
// adjudication drains after every applied command, and because that drain is not a policy act,
// `evaluate` reports whether it happened rather than folding it into the pass/fail cell.

const MAX_PROMPT_DRAIN = 50;

/**
 * Resolve every prompt in `state.promptQueue` with `status === "pending"`, via the same
 * resolveBotPromptCommand runBotMatch itself uses between a strategy's own commands
 * (bot-harness.ts: `drainPendingPrompts`). That internal drain silently breaks out and leaves the
 * surrounding harness to notice the position is stuck; a puzzle must not silently mis-score a
 * stalled, mid-prompt state as though it were final, so this one fails loudly instead once
 * MAX_PROMPT_DRAIN is exceeded, catching a real infinite-prompt bug rather than hanging the suite.
 */
function drainPrompts(state: MatchState): { state: MatchState; drained: boolean } {
  let current = state;
  let drained = false;
  for (let i = 0; i < MAX_PROMPT_DRAIN; i++) {
    const prompt = current.promptQueue.find((entry) => entry.status === "pending");
    if (!prompt) return { state: current, drained };
    const command = resolveBotPromptCommand(current, prompt);
    if (!command) {
      throw new Error(
        `prompt drain stalled: resolveBotPromptCommand returned no command for a pending ${prompt.kind}/${prompt.choiceKind ?? "?"} prompt`,
      );
    }
    const r = applyCommand(current, command);
    if (!r.accepted) {
      throw new Error(
        `prompt drain stalled: resolveBotPromptCommand's own command was illegal (${r.reason ?? "no reason given"})`,
      );
    }
    current = r.state;
    drained = true;
  }
  const stillPending = current.promptQueue.find((entry) => entry.status === "pending");
  if (stillPending) {
    throw new Error(
      `prompt drain exceeded ${MAX_PROMPT_DRAIN} iterations -- still pending: ${stillPending.kind}/${stillPending.choiceKind ?? "?"}`,
    );
  }
  return { state: current, drained };
}

/**
 * What a LINE of commands actually accomplishes, ADJUDICATED BY THE ENGINE rather than by a
 * hand-written predicate. This is the second design of this function and the reason for the change
 * matters: the first version hard-coded "the answer is an attack by the 8000 body", which silently
 * MISCLASSIFIED south's own leader attack -- a 5000 leader reaches a 5000 leader on 0 life and wins
 * outright. Any policy choosing it would have been reported as failing a puzzle it had just solved.
 *
 * The SOLVABLE/DISCRIMINATING guards cannot catch that class of defect: both were satisfied, because
 * a correct answer and an incorrect answer each existed. Only the engine knows which commands win,
 * so the engine is asked. Vanilla bodies and an empty defending hand mean the battle resolves inside
 * applyCommand with no pending prompts (verified), so for the 6 original puzzles a single command
 * plus a single (no-op) drain is enough -- but `cmds` may also be an explicit sequence, applied and
 * drained one command at a time, for puzzles spanning a whole turn.
 */
function adjudicate(
  p: Puzzle,
  cmds: EngineCommand | EngineCommand[],
): { won: boolean; material: boolean; drained: boolean } | null {
  const line = Array.isArray(cmds) ? cmds : [cmds];
  let state = p.build().getState();
  const lifeBefore = state.players[OPP].life.length;
  const bodiesBefore = state.players[OPP].characterArea.filter(Boolean).length;
  let drained = false;
  for (const cmd of line) {
    const r = applyCommand(state, cmd);
    if (!r.accepted) return null;
    const d = drainPrompts(r.state);
    state = d.state;
    if (d.drained) drained = true;
  }
  const after = state;
  const damage = lifeBefore - after.players[OPP].life.length;
  const koed = bodiesBefore - after.players[OPP].characterArea.filter(Boolean).length;
  return { won: after.winner === SEAT, material: damage > 0 || koed > 0, drained };
}

/** Does an adjudicated outcome satisfy `p`? Split out so a solvability check and a strategy's own
 *  command are always held to the identical rule. */
function passes(p: Puzzle, out: { won: boolean; material: boolean }): boolean {
  // lethal: nothing short of winning is defensible when the game can be won this turn.
  // futile: any command that gains material is fine; the error under test is gaining nothing.
  return p.klass === "lethal" ? out.won : out.won || out.material;
}

/**
 * Is `cmds` a defensible answer to `p`, and did reaching that verdict require the engine's own
 * prompt resolver? The two are reported together because a "yes" that only holds because
 * resolveBotPromptCommand happened to resolve some prompt a particular way is not purely a policy
 * result -- see the drainPrompts doc comment above.
 */
function evaluate(
  p: Puzzle,
  cmds: EngineCommand | EngineCommand[],
): { ok: boolean; drained: boolean } {
  const out = adjudicate(p, cmds);
  if (out === null) return { ok: false, drained: false };
  return { ok: passes(p, out), drained: out.drained };
}

// `firstPlayer` is NORTH deliberately. canAttackWith() has
//   if (state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer) return false;
// -- the first player may not attack on their own first turn. Seating south as the first player
// makes every attack illegal on turn 1, which silently turns an attack puzzle into a position whose
// only legal command is endTurn. The suite's SOLVABLE guard caught exactly that on the first run;
// without it this would have been reported as the policy failing five lethal puzzles.
function board(
  south: object,
  north: object,
  opts: { restLeader?: boolean } = {},
): OnePieceTestEngine {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: LEADER, deck: 20, ...south },
    { leaderCardId: LEADER, deck: 20, ...north },
    { activeSeat: SEAT, firstPlayer: "north" },
  );
  if (opts.restLeader) {
    // The acting leader is a legal attacker in its own right, so resting it is how a puzzle isolates
    // a choice among CHARACTERS. Found the hard way: a puzzle meant to force the 8000 body was also
    // solvable by swinging the 5000 leader into a 5000 leader on 0 life.
    const s = engine.getState();
    const inst = s.cards[s.players[SEAT].leaderInstanceId];
    if (inst) inst.rested = true;
  }
  return engine;
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
    why: "North is on 0 life with an empty board. Any attack that reaches the 5000 leader wins outright; ending the turn throws the game away.",
    build: () => board({ character: [{ cardId: P6000, playedOnTurn: 0 }] }, { life: 0 }),
    expect: "pass",
  },
  {
    id: "lethal-decoy-body",
    klass: "lethal",
    why: "Same lethal, but a rested 4000 sits there as bait. K.O.ing it is a real play that accomplishes nothing; only a leader attack wins.",
    build: () =>
      board(
        { character: [{ cardId: P6000, playedOnTurn: 0 }] },
        { life: 0, character: [{ cardId: P4000, rested: true, playedOnTurn: 0 }] },
      ),
    expect: "pass",
  },
  {
    id: "lethal-reaching-attacker",
    klass: "lethal",
    why: "Two candidate bodies plus the leader. The 4000 does not reach a 5000 leader (attackPower >= defensePower fails, so it whiffs); the 8000 does, and so does the 5000 leader itself. Winning requires picking a body that reaches -- either of the two.",
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
    expect: "pass",
  },
  {
    id: "lethal-leader-rested",
    klass: "lethal",
    why: "The variant that isolates the character choice: the leader is rested and cannot attack, so the only winning command is the 8000 body. The 4000 whiffs against a 5000 leader.",
    build: () =>
      board(
        {
          character: [
            { cardId: P4000, playedOnTurn: 0 },
            { cardId: P8000, playedOnTurn: 0 },
          ],
        },
        { life: 0 },
        { restLeader: true },
      ),
    expect: "pass",
  },
  {
    id: "futile-unbeatable-body",
    klass: "futile",
    why: "A 6000 cannot dent a rested 10000 and gains nothing by trying. The 5000 leader is reachable for real damage, so only the futile swing and passing are wrong.",
    build: () =>
      board(
        { character: [{ cardId: P6000, playedOnTurn: 0 }] },
        { life: 2, character: [{ cardId: P10000, rested: true, playedOnTurn: 0 }] },
      ),
    expect: "pass",
  },
  {
    id: "futile-pick-any-productive",
    klass: "futile",
    why: "An 8000 can K.O. the rested 4000 or damage the 5000 leader; both gain material and no preference is asserted between them. It cannot beat the rested 10000, so only that swing gains nothing.",
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
    expect: "pass",
  },
];

run("puzzles", () => {
  if (allCards.length === 0) throw new Error("card registry empty");
  const names = LADDER.map(([n]) => n);
  console.log(
    `\nPUZZLES  ${PUZZLES.length} positions  catalog=${allCards.length}\n` +
      `${"".padEnd(30)}${names.map((n) => n.slice(0, 11).padStart(12)).join("")}   guards        prompts`,
  );

  const suiteDefects: string[] = [];
  const regressions: string[] = [];
  const byClass = new Map<string, { n: number; ok: number }>();

  for (const p of PUZZLES) {
    const state = p.build().getState();
    const options = concrete(state, SEAT);
    const optionResults = options.map((c) => evaluate(p, c));
    const solvable = optionResults.filter((r) => r.ok).length;
    const wrong = options.length - solvable;
    // Whether THIS puzzle's evaluation -- guard computation plus every strategy below -- ever had
    // to call resolveBotPromptCommand. Batch 2 Task 1: report it, don't fold it into pass/fail.
    let promptsDrained = optionResults.some((r) => r.drained);

    // A puzzle that cannot be failed, or cannot be solved, is a defect in the SUITE, not the policy.
    if (solvable === 0)
      suiteDefects.push(`${p.id}: BROKEN — no legal command satisfies the answer`);
    if (wrong === 0)
      suiteDefects.push(`${p.id}: VACUOUS — every legal command satisfies the answer`);

    const cells: string[] = [];
    for (const [name, strategy] of LADDER) {
      const fresh = p.build().getState();
      const cmd = strategy(fresh, SEAT, getLegalCommands(fresh, SEAT));
      const { ok, drained } = cmd !== null ? evaluate(p, cmd) : { ok: false, drained: false };
      if (drained) promptsDrained = true;
      cells.push((ok ? "pass" : "FAIL").padStart(12));
      if (name === "valueRanked") {
        const agg = byClass.get(p.klass) ?? { n: 0, ok: 0 };
        agg.n += 1;
        if (ok) agg.ok += 1;
        byClass.set(p.klass, agg);
        // The measured policy's result is the PRIMARY output, so it is asserted rather than merely
        // printed. Without this the suite exited 0 even if valueRanked regressed from 6/6 to 0/6.
        // Lower rungs stay diagnostics only -- their scores calibrate difficulty, nothing more.
        if (ok && p.expect === "fail") {
          regressions.push(`${p.id}: expected valueRanked to FAIL but it passed — update expect`);
        }
        if (!ok && p.expect === "pass") {
          regressions.push(
            `${p.id}: valueRanked FAILED a puzzle it is expected to solve — ${p.why}`,
          );
        }
      }
    }
    console.log(
      `${p.id.padEnd(30)}${cells.join("")}   ${solvable}/${options.length} correct of legal` +
        `   prompts=${promptsDrained ? "drained" : "none"}`,
    );
  }

  console.log("\nvalueRanked by decision class:");
  for (const [klass, agg] of byClass) {
    console.log(`  ${klass.padEnd(10)} ${agg.ok}/${agg.n}`);
  }

  if (suiteDefects.length) {
    console.log("\nSUITE DEFECTS (bugs in the puzzles, not in the policy):");
    for (const f of suiteDefects) console.log(`  ${f}`);
  }
  if (regressions.length) {
    console.log("\nPOLICY REGRESSIONS (bugs in the policy, or a stale baseline):");
    for (const f of regressions) console.log(`  ${f}`);
  }
  const all = [...suiteDefects, ...regressions];
  if (all.length) throw new Error(all.join(" | "));
});
