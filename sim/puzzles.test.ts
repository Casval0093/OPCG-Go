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
//   * SOLVABLE  -- at least one legal line satisfies the answer, else the position is broken
//   * DISCRIMINATING -- at least one legal line does NOT, else the puzzle is vacuous
// Both are asserted at run time and reported per puzzle. A suite that every policy passes is
// measuring nothing, so the whole ladder is run against it and the pass count per puzzle is printed:
// if `random` solves it, the puzzle is too easy to be diagnostic.
//
// The classes here were verified against engine source before any puzzle was written, rather than
// from memory of the paper rules:
//   * lethal  -- battle.ts: `if (defender.life.length === 0)` and the attack connects => winner is
//     the attacker. So lethal means 0 life cards plus an attack that reaches.
//   * futile  -- battle.ts: `if (battle.attackPower >= battle.defensePower)` gates ALL damage, and
//     the else branch does nothing to the attacker. There is no mutual destruction in this game, so
//     "suicide attack" is not a real class; the real error is spending an attack on a body you
//     cannot beat when a productive attack exists.
//   * donAllocation / sequencing -- commands.ts:590 `attachDon` (main phase, own leader or
//     character, `activeDon >= amount`) and shared.ts:462 `getCardPower`, where each attached DON!!
//     is worth +1000 AND ONLY WHILE ITS CONTROLLER IS THE ACTIVE SEAT. Batch 2.
//   * koVsDamage -- an ARCHITECTURE PROBE, not a policy measurement. See the block above its
//     puzzles: no ladder policy can choose an attack target at all, so all five fail these for one
//     structural reason. Kept, labelled, and excluded from the policy totals.
//
// BATCH 2 FIXTURE TRAP -- READ BEFORE ADDING A DON!! PUZZLE.
// `OP01-001` Roronoa Zoro, the leader the six original puzzles use for BOTH seats, is NOT a vanilla
// leader: "[DON!! x1] [Your Turn] All of your Characters gain +1000 power", encoded as a
// permanentEffect keyed on `donAttached >= 1`. Attaching a single DON!! to that leader silently
// buffs every one of your characters, which makes "attach DON!! to your leader" a real play rather
// than the blunder a DON!! puzzle needs it to be. It was caught by measurement, not by reading: a
// probe showed a 5000 body attacking at 6000 after DON!! went to the LEADER.
// The six originals are unaffected ONLY because they have 0 active DON!! so the condition cannot
// fire -- `fixture integrity` below asserts exactly that, so the day someone adds DON!! to one of
// them the suite says so instead of quietly mis-scoring.
// There is no vanilla leader in the game (all 135 have effect text), so the batch-2 puzzles use
// leaders screened for INERTNESS instead, also asserted below.

import { test } from "vite-plus/test";
import { allCards, op16PortgasDAce001, op16PortgasDAce118, op01Sai012 } from "@tcg/op-cards";
import { applyCommand, getLegalCommands } from "../../src/core.ts";
import {
  valueRankedStrategy,
  greedyStrategy,
  randomStrategy,
  firstLegalStrategy,
  passOnlyStrategy,
  commandFromDescriptor,
} from "../../src/automation/bot-strategies.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";
import { resolveBotPromptCommand } from "../../src/automation/bot-harness.ts";
import { OnePieceTestEngine } from "../../src/index.ts";
import { getCardPower, getKeywords } from "../../src/shared.ts";
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

// --- Batch 1 fixtures: vanilla bodies, so a puzzle's answer turns only on power and board state.
const LEADER = "OP01-001"; // Roronoa.Zoro, 5000 -- NOT inert, see the fixture trap above.
const P4000 = "OP01-012"; // Sai
const P6000 = "OP01-018"; // Hajrudin
const P8000 = "OP01-110"; // Fukurokuju
const P10000 = "OP05-044"; // John Giant

// --- Batch 2 fixtures. Leaders screened for INERTNESS (no donAttached power grant, no
// [Activate:Main] to add a stray legal command, no attack triggers); bodies are Block 2+ vanillas
// with no effect text and no `effects:` encoding. Both properties are asserted in `fixture
// integrity` rather than trusted, because the whole batch turns on them.
const LEAD_INERT_5000 = "OP16-060"; // south's leader in every batch-2 puzzle
const LEAD_INERT_5000B = "OP05-022"; // north, where a 5000 wall is wanted
const LEAD_INERT_6000 = "OP11-040"; // north, where the attack must be BUFFED to connect
const V3000 = "OP16-023"; // Arlong
const V4000 = "OP05-083"; // Sterry
const V5000 = "OP05-012"; // Hack, counter 1000
const V6000 = "EB02-034"; // Komei
const V7000 = "EB01-018"; // Mountain God
const V8000 = "OP06-005"; // Gasparde
const V9000 = "OP09-067"; // Jinbe
const BLOCKER = "OP05-013"; // 2000 body carrying the real [Blocker] keyword (Task 5)

type Klass = "lethal" | "futile" | "donAllocation" | "sequencing" | "koVsDamage";

interface Puzzle {
  id: string;
  klass: Klass;
  /**
   * "command" scores the strategy on ONE command, which is all a single-decision position needs and
   * is exactly how the six batch-1 puzzles were scored when their published numbers were measured.
   * "turn" plays the strategy's WHOLE turn and judges the resulting position, which is the only way
   * to score a decision that spans several commands (attach DON!! THEN swing). The two measure
   * different things and are never averaged; batch 1 stays on "command" so its baseline is
   * comparable to what docs/simulation.md already records.
   */
  mode: "command" | "turn";
  /** Why exactly one family of answers is defensible. Prose, for the failure report. */
  why: string;
  build: () => OnePieceTestEngine;
  /** Baseline for `valueRanked`, asserted. Set "fail" only for a puzzle it is known not to solve. */
  expect: "pass" | "fail";
  /**
   * Play the opponent's whole reply turn and score SURVIVAL rather than immediate material. The
   * threat has to be real, so `THREATENED` below asserts that doing nothing actually loses.
   */
  opponentReply?: boolean;
  /**
   * Excluded from the `valueRanked by decision class` totals. The puzzle measures an ENGINE/API
   * limitation that no strategy can route around, so scoring it as policy quality would be a
   * category error -- the same reason the prompt-resolver suite at the bottom is reported apart.
   */
  architectural?: boolean;
}

const SEAT: MatchSeat = "south";
const OPP: MatchSeat = "north";

const MAX_PROMPT_DRAIN = 50;
const MAX_TURN_STEPS = 40;
const MAX_REPLY_STEPS = 80;
/** Node budget for the guard's line enumeration. Fails loudly rather than hanging the suite. */
const MAX_LINES = 20000;

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

interface Outcome {
  won: boolean;
  material: boolean;
  damage: number;
  koed: number;
  /** Only meaningful when the puzzle set `opponentReply`; otherwise "did not lose during our turn". */
  survived: boolean;
  drained: boolean;
}

/** Apply one command and drain whatever it opened. Returns null if the engine rejected it. */
function step(
  state: MatchState,
  cmd: EngineCommand,
): { state: MatchState; drained: boolean } | null {
  const r = applyCommand(state, cmd);
  if (!r.accepted) return null;
  const d = drainPrompts(r.state);
  return { state: d.state, drained: d.drained };
}

/**
 * A seeded LCG, so `random`'s turn-mode play is varied but reproducible run to run.
 *
 * COMMAND mode deliberately does NOT use this: batch 1's published table was measured by calling
 * the strategy with NO decision context at all, which makes `randomStrategy`'s `context?.random ??
 * (() => 0)` fall back to 0 and always take the first descriptor. Feeding it real randomness moved
 * `random` from 0/6 to 4/6 on those six puzzles -- a change in the measuring instrument, not in the
 * policy. Command mode therefore keeps the original call and the original numbers, and `random`'s
 * two columns are not comparable across modes. Both facts are stated in docs/simulation.md.
 */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Run `seat`'s turn to completion under `strategy`, returning the commands it actually chose. */
function playTurn(
  state: MatchState,
  seat: MatchSeat,
  strategy: OnePieceBotStrategy,
  cap: number,
  random: () => number = makeRandom(0x5eed),
): { state: MatchState; drained: boolean; line: EngineCommand[] } {
  let current = state;
  let drained = false;
  const line: EngineCommand[] = [];
  for (let i = 0; i < cap; i++) {
    const d0 = drainPrompts(current);
    current = d0.state;
    if (d0.drained) drained = true;
    if (current.winner !== null || current.activeSeat !== seat || current.status !== "active")
      break;
    const legal = getLegalCommands(current, seat);
    if (legal.length === 0) break;
    const cmd = strategy(current, seat, legal, { random });
    if (!cmd) break;
    const next = step(current, cmd);
    if (!next) break;
    line.push(cmd);
    current = next.state;
    if (next.drained) drained = true;
    if (cmd.type === "endTurn") break;
  }
  return { state: current, drained, line };
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
 * so the engine is asked.
 */
function outcomeOf(
  p: Puzzle,
  drive: (state: MatchState) => { state: MatchState; drained: boolean } | null,
): Outcome | null {
  const initial = p.build().getState();
  const lifeBefore = initial.players[OPP].life.length;
  const bodiesBefore = initial.players[OPP].characterArea.filter(Boolean).length;
  const driven = drive(initial);
  if (driven === null) return null;
  let state = driven.state;
  let drained = driven.drained;

  // Material is measured at the END OF OUR TURN, before any reply -- otherwise the opponent's own
  // turn (it draws, it plays, it attacks) would be folded into "what our line accomplished".
  const damage = lifeBefore - state.players[OPP].life.length;
  const koed = bodiesBefore - state.players[OPP].characterArea.filter(Boolean).length;
  const won = state.winner === SEAT;

  if (p.opponentReply && state.winner === null) {
    if (state.activeSeat === SEAT) {
      const ended = step(state, { type: "endTurn", seat: SEAT } as EngineCommand);
      if (ended) {
        state = ended.state;
        if (ended.drained) drained = true;
      }
    }
    // The opponent replies with valueRanked -- the strongest rung, so a threat that lands is a
    // threat a competent opponent would actually take, not one manufactured by a weak reply.
    const reply = playTurn(state, OPP, valueRankedStrategy, MAX_REPLY_STEPS, makeRandom(0xd00d));
    state = reply.state;
    if (reply.drained) drained = true;
  }

  return {
    won,
    material: damage > 0 || koed > 0,
    damage,
    koed,
    survived: state.winner !== OPP,
    drained,
  };
}

/** Does an adjudicated outcome satisfy `p`? Split out so a solvability check and a strategy's own
 *  play are always held to the identical rule. */
function passes(p: Puzzle, out: Outcome): boolean {
  switch (p.klass) {
    // lethal: nothing short of winning is defensible when the game can be won this turn.
    case "lethal":
      return out.won;
    // futile: any command that gains material is fine; the error under test is gaining nothing.
    case "futile":
      return out.won || out.material;
    // donAllocation: the attack must actually CONNECT, which it only does if the DON!! went on
    // first. Leader damage is the observable because a body cannot be targeted (see koVsDamage).
    case "donAllocation":
      return out.damage > 0;
    // sequencing: the whole line either wins or it does not.
    case "sequencing":
      return out.won;
    // koVsDamage: survive the opponent's reply.
    case "koVsDamage":
      return out.survived;
  }
}

/** Evaluate an explicit line of commands. */
function evaluateLine(p: Puzzle, cmds: EngineCommand[]): { ok: boolean; drained: boolean } | null {
  const out = outcomeOf(p, (initial) => {
    let state = initial;
    let drained = false;
    for (const cmd of cmds) {
      const next = step(state, cmd);
      if (next === null) return null;
      state = next.state;
      if (next.drained) drained = true;
    }
    return { state, drained };
  });
  if (out === null) return null;
  return { ok: passes(p, out), drained: out.drained };
}

/** Evaluate what a strategy actually does, in the puzzle's own mode. */
function evaluateStrategy(
  p: Puzzle,
  strategy: OnePieceBotStrategy,
): { ok: boolean; drained: boolean } {
  const out = outcomeOf(p, (initial) => {
    if (p.mode === "turn") {
      const r = playTurn(initial, SEAT, strategy, MAX_TURN_STEPS);
      return { state: r.state, drained: r.drained };
    }
    // No decision context, exactly as batch 1 was measured -- see makeRandom's comment.
    const cmd = strategy(initial, SEAT, getLegalCommands(initial, SEAT));
    if (!cmd) return null;
    return step(initial, cmd);
  });
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
  opts: { restLeader?: boolean; southLeader?: string; northLeader?: string } = {},
): OnePieceTestEngine {
  const engine = OnePieceTestEngine.create(
    { leaderCardId: opts.southLeader ?? LEADER, deck: 20, ...south },
    { leaderCardId: opts.northLeader ?? LEADER, deck: 20, ...north },
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

/** The concrete commands a seat could actually submit, expanded from the legal descriptors.
 *  declareAttack is expanded per (attacker, target) PAIR on purpose: the engine bundles every
 *  target of one attacker into a single descriptor, so only this expansion can see the choice that
 *  `commandFromDescriptor` throws away. attachDon is expanded per target for the same reason. */
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
    } else if (d.type === "attachDon" && d.sourceId) {
      out.push({ type: "attachDon", seat, targetId: d.sourceId, amount: 1 } as EngineCommand);
    } else if (d.type === "endTurn") {
      out.push({ type: "endTurn", seat } as EngineCommand);
    }
  }
  return out;
}

/**
 * Bounded exhaustive enumeration of every line SEAT could play this turn, for the SOLVABLE and
 * DISCRIMINATING guards. A single-command puzzle enumerates its one-command lines, which is exactly
 * what batch 1 did; a turn-mode puzzle enumerates real sequences, so its guards are still a
 * statement about the whole legal line space rather than about two lines someone hand-picked.
 * Fails loudly on the node budget instead of silently reporting guards computed on a subset.
 */
function enumerateLines(p: Puzzle): EngineCommand[][] {
  const lines: EngineCommand[][] = [];
  let nodes = 0;
  const maxDepth = p.mode === "turn" ? 6 : 1;
  const walk = (state: MatchState, prefix: EngineCommand[]) => {
    if (lines.length + nodes > MAX_LINES)
      throw new Error(`${p.id}: line enumeration exceeded ${MAX_LINES} nodes`);
    if (prefix.length >= maxDepth) {
      if (prefix.length) lines.push(prefix);
      return;
    }
    const options = concrete(state, SEAT);
    if (options.length === 0) {
      if (prefix.length) lines.push(prefix);
      return;
    }
    for (const cmd of options) {
      nodes++;
      const next = step(state, cmd);
      if (next === null) continue;
      const line = [...prefix, cmd];
      if (cmd.type === "endTurn" || next.state.winner !== null || next.state.activeSeat !== SEAT) {
        lines.push(line);
      } else {
        walk(next.state, line);
      }
    }
  };
  walk(p.build().getState(), []);
  return lines;
}

const PUZZLES: Puzzle[] = [
  // ---------------------------------------------------------------- batch 1: single-command
  {
    id: "lethal-bare",
    klass: "lethal",
    mode: "command",
    why: "North is on 0 life with an empty board. Any attack that reaches the 5000 leader wins outright; ending the turn throws the game away.",
    build: () => board({ character: [{ cardId: P6000, playedOnTurn: 0 }] }, { life: 0 }),
    expect: "pass",
  },
  {
    id: "lethal-decoy-body",
    klass: "lethal",
    mode: "command",
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
    mode: "command",
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
    mode: "command",
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
    mode: "command",
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
    mode: "command",
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

  // ---------------------------------------------------------------- batch 2: donAllocation
  // The observable is always LEADER DAMAGE, never a K.O., because no policy can target a body --
  // see the koVsDamage block. A DON!! puzzle scored on K.O.s would be measuring that limitation
  // again instead of DON!! allocation.
  {
    id: "don-attach-before-attack",
    klass: "donAllocation",
    mode: "turn",
    why: "A 5000 body against a 6000 Leader whiffs (attackPower >= defensePower fails). One DON!! makes it exactly 6000 and it connects. The DON!! must go on BEFORE the swing -- attaching afterwards is legal, scores well, and accomplishes nothing, because the body has already rested.",
    build: () =>
      board(
        { activeDon: 1, hand: 0, character: [{ cardId: V5000, playedOnTurn: 0 }] },
        { life: 2, hand: 0 },
        { restLeader: true, southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_6000 },
      ),
    expect: "fail",
  },
  {
    id: "don-pick-the-body-that-reaches",
    klass: "donAllocation",
    mode: "turn",
    why: "One DON!! and two bodies against a 5000 Leader. On the 4000 it reaches exactly 5000 and connects; on the 3000 it reaches 4000 and still whiffs, and so does the unbuffed 4000. Only one of the two bodies converts the DON!! into damage.",
    build: () =>
      board(
        {
          activeDon: 1,
          hand: 0,
          character: [
            { cardId: V4000, playedOnTurn: 0 },
            { cardId: V3000, playedOnTurn: 0 },
          ],
        },
        { life: 2, hand: 0 },
        { restLeader: true, southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_5000B },
      ),
    expect: "pass",
  },
  {
    id: "don-concentrate-to-reach",
    klass: "donAllocation",
    mode: "turn",
    why: "Two DON!! and two 4000 bodies against a 6000 Leader. Split one each, both attack at 5000 and both whiff; stacked on a single body it reaches exactly 6000 and connects. Here concentration is right -- the mirror of don-spread-not-concentrate, so the pair cannot be passed by one fixed habit.",
    build: () =>
      board(
        {
          activeDon: 2,
          hand: 0,
          character: [
            { cardId: V4000, playedOnTurn: 0 },
            { cardId: V4000, playedOnTurn: 0 },
          ],
        },
        { life: 2, hand: 0 },
        { restLeader: true, southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_6000 },
      ),
    expect: "pass",
  },

  // ---------------------------------------------------------------- batch 2: sequencing
  {
    id: "seq-attach-then-swing-for-lethal",
    klass: "sequencing",
    mode: "turn",
    why: "The same shape as don-attach-before-attack, but North is on 0 life, so the connecting attack does not merely deal damage -- it WINS. Identical commands, opposite results by order: attach then swing wins the game, swing then attach loses the turn.",
    build: () =>
      board(
        { activeDon: 1, hand: 0, character: [{ cardId: V5000, playedOnTurn: 0 }] },
        { life: 0, hand: 0 },
        { restLeader: true, southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_6000 },
      ),
    expect: "fail",
  },
  {
    id: "seq-spread-not-concentrate",
    klass: "sequencing",
    mode: "turn",
    why: "North is on 1 life behind a 6000 Leader, and two 5000 bodies each need exactly one DON!! to reach it. Spread one each and both connect: the first strips the last life card, the second wins. Stack both on one body and it swings at 7000 while the other whiffs at 5000 -- one connection, no win. Concentrating DON!! on the best attacker is the wrong habit here.",
    build: () =>
      board(
        {
          activeDon: 2,
          hand: 0,
          character: [
            { cardId: V5000, playedOnTurn: 0 },
            { cardId: V5000, playedOnTurn: 0 },
          ],
        },
        { life: 1, hand: 0 },
        { restLeader: true, southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_6000 },
      ),
    expect: "fail",
  },

  // ---------------------------------------------------------------- batch 2: koVsDamage
  // ARCHITECTURE PROBE, NOT A POLICY MEASUREMENT -- and the reason is worth stating in full,
  // because the original plan asked for this class as a policy test and it cannot be one.
  //
  //   engine/legal.ts:181  emits ONE declareAttack descriptor per ATTACKER, bundling every legal
  //                        target into `targetIds`.
  //   bot-strategies.ts:81 commandFromDescriptor takes `targetIds[0]` UNCONDITIONALLY.
  //   battle.ts:737        legalAttackTargets pushes the defending LEADER first.
  //
  // All five ladder strategies build their command through that helper, `random` included, so the
  // target of every attack any policy declares is the defending leader whenever the leader is a
  // legal target. Target choice is unreachable, not merely unexercised. These puzzles therefore
  // fail for ALL five for one structural reason; they are kept because they demonstrate the
  // CONSEQUENCE -- a game lost that was winnable -- which the API-level assertion below cannot, and
  // because the day someone gives the strategies target choice, `expect: "fail"` flips and the
  // suite says so. They are excluded from the policy totals.
  {
    id: "ko-or-die-single-threat",
    klass: "koVsDamage",
    mode: "turn",
    architectural: true,
    opponentReply: true,
    why: "South is on 1 life. North's rested 6000 refreshes into an attacker next turn, and Leader plus body is two connecting attacks -- exactly lethal from 1 life. K.O.ing that body with the 8000 leaves North's Leader as its only attacker and South lives at 0. A leader swing is material and loses the game anyway.",
    build: () =>
      board(
        { life: 1, hand: 0, character: [{ cardId: V8000, playedOnTurn: 0 }] },
        { life: 3, hand: 0, character: [{ cardId: V6000, rested: true, playedOnTurn: 0 }] },
        { southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_5000B },
      ),
    expect: "fail",
  },
  {
    id: "ko-or-die-pick-the-attacker",
    klass: "koVsDamage",
    mode: "turn",
    architectural: true,
    opponentReply: true,
    why: "Same race, but South must also pick the right attacker: only the 8000 beats North's rested 7000, and the 5000 body whiffs against it. Two ways to get this wrong -- wrong target, or right target with the wrong body.",
    build: () =>
      board(
        {
          life: 1,
          hand: 0,
          character: [
            { cardId: V5000, playedOnTurn: 0 },
            { cardId: V8000, playedOnTurn: 0 },
          ],
        },
        { life: 3, hand: 0, character: [{ cardId: V7000, rested: true, playedOnTurn: 0 }] },
        { southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_5000B },
      ),
    expect: "fail",
  },
  {
    id: "ko-or-die-thin-the-swarm",
    klass: "koVsDamage",
    mode: "turn",
    architectural: true,
    opponentReply: true,
    why: "South is on 2 life against a Leader and two rested 6000 bodies -- three connecting attacks next turn, one more than South can absorb. Removing any ONE body is enough, so this does not turn on picking the right target, only on attacking a body at all rather than the Leader.",
    build: () =>
      board(
        { life: 2, hand: 0, character: [{ cardId: V9000, playedOnTurn: 0 }] },
        {
          life: 3,
          hand: 0,
          character: [
            { cardId: V6000, rested: true, playedOnTurn: 0 },
            { cardId: V6000, rested: true, playedOnTurn: 0 },
          ],
        },
        { southLeader: LEAD_INERT_5000, northLeader: LEAD_INERT_5000B },
      ),
    expect: "fail",
  },
];

run(
  "puzzles",
  () => {
    if (allCards.length === 0) throw new Error("card registry empty");
    const names = LADDER.map(([n]) => n);
    console.log(
      `\nPUZZLES  ${PUZZLES.length} positions  catalog=${allCards.length}\n` +
        `${"".padEnd(32)}${names.map((n) => n.slice(0, 11).padStart(12)).join("")}   guards        prompts`,
    );

    const suiteDefects: string[] = [];
    const regressions: string[] = [];
    const byClass = new Map<string, { n: number; ok: number }>();
    const perStrategy = new Map<
      string,
      { policy: number; policyN: number; arch: number; archN: number }
    >();
    for (const [n] of LADDER) perStrategy.set(n, { policy: 0, policyN: 0, arch: 0, archN: 0 });
    let lastKlass = "";

    for (const p of PUZZLES) {
      if (p.klass !== lastKlass) {
        console.log(
          `-- ${p.klass}${p.architectural ? "  (ARCHITECTURE PROBE - not scored as policy)" : ""}`,
        );
        lastKlass = p.klass;
      }
      const lines = enumerateLines(p);
      const results = lines
        .map((l) => evaluateLine(p, l))
        .filter((r): r is { ok: boolean; drained: boolean } => r !== null);
      const solvable = results.filter((r) => r.ok).length;
      const wrong = results.length - solvable;
      let promptsDrained = results.some((r) => r.drained);

      // A puzzle that cannot be failed, or cannot be solved, is a defect in the SUITE, not the policy.
      if (solvable === 0) suiteDefects.push(`${p.id}: BROKEN — no legal line satisfies the answer`);
      if (wrong === 0)
        suiteDefects.push(`${p.id}: VACUOUS — every legal line satisfies the answer`);

      // THREATENED: an opponent-reply puzzle is only a puzzle if doing nothing actually loses. Without
      // this a position where South survives no matter what would score every policy "pass" and look
      // like a clean result.
      if (p.opponentReply) {
        const idle = evaluateLine(p, [{ type: "endTurn", seat: SEAT } as EngineCommand]);
        if (idle === null || idle.ok) {
          suiteDefects.push(
            `${p.id}: NOT THREATENED — passing the turn does not lose, so nothing is being asked`,
          );
        }
      }

      const cells: string[] = [];
      for (const [name, strategy] of LADDER) {
        const { ok, drained } = evaluateStrategy(p, strategy);
        if (drained) promptsDrained = true;
        cells.push((ok ? "pass" : "FAIL").padStart(12));
        const agg = perStrategy.get(name)!;
        if (p.architectural) {
          agg.archN += 1;
          if (ok) agg.arch += 1;
        } else {
          agg.policyN += 1;
          if (ok) agg.policy += 1;
        }
        if (name === "valueRanked") {
          if (!p.architectural) {
            const c = byClass.get(p.klass) ?? { n: 0, ok: 0 };
            c.n += 1;
            if (ok) c.ok += 1;
            byClass.set(p.klass, c);
          }
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
        `${p.id.padEnd(32)}${cells.join("")}   ${solvable}/${results.length} correct of legal` +
          `   prompts=${promptsDrained ? "drained" : "none"}`,
      );
    }

    console.log("\nvalueRanked by decision class (architecture probes excluded):");
    for (const [klass, agg] of byClass) console.log(`  ${klass.padEnd(14)} ${agg.ok}/${agg.n}`);

    console.log("\nladder totals:");
    for (const [name] of LADDER) {
      const a = perStrategy.get(name)!;
      console.log(
        `  ${name.padEnd(12)} policy ${a.policy}/${a.policyN}   architecture probe ${a.arch}/${a.archN}`,
      );
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
    // 60s, not the 5s default: the guards enumerate the whole legal LINE space for every turn-mode
    // puzzle (209 lines for the two-body, two-DON!! positions) and each line is played out in the
    // engine. That cost buys guards that are a statement about every line, not two hand-picked ones.
  },
  60_000,
);

/**
 * The batch-2 puzzles are only meaningful if their fixtures are what the prose claims, so the
 * claims are asserted rather than trusted. Two of these were NOT true of the obvious card choice:
 * OP01-001's leader effect buffs every character when it holds a DON!!, and OP13-003's printed 7000
 * plays as 9000. Both were caught by measurement.
 */
run("fixture integrity", () => {
  // 1. Batch-1 puzzles must have no active DON!!, or OP01-001's "[DON!! x1] [Your Turn] All of your
  //    Characters gain +1000 power" silently rewrites their arithmetic.
  for (const p of PUZZLES.filter((q) => q.mode === "command")) {
    const s = p.build().getState();
    if (s.players[SEAT].activeDon !== 0) {
      throw new Error(
        `${p.id} uses ${LEADER}, whose [DON!! x1] buffs all your Characters +1000, AND has ` +
          `${s.players[SEAT].activeDon} active DON!! — the position no longer means what its prose says`,
      );
    }
  }

  // 2. The batch-2 leaders must be INERT: attaching a DON!! to the leader must not change a
  //    character's power, and the leader must add no extra legal command type.
  for (const leader of [LEAD_INERT_5000, LEAD_INERT_5000B, LEAD_INERT_6000]) {
    const e = OnePieceTestEngine.create(
      {
        leaderCardId: leader,
        deck: 20,
        hand: 0,
        activeDon: 1,
        character: [{ cardId: V5000, playedOnTurn: 0 }],
      },
      { leaderCardId: LEAD_INERT_5000B, deck: 20, hand: 0, life: 2 },
      { activeSeat: SEAT, firstPlayer: "north" },
    );
    const s = e.getState();
    const char = s.players[SEAT].characterArea.find(Boolean)!;
    const before = getCardPower(s, char);
    const r = applyCommand(s, {
      type: "attachDon",
      seat: SEAT,
      targetId: s.players[SEAT].leaderInstanceId,
      amount: 1,
    } as EngineCommand);
    if (!r.accepted) throw new Error(`${leader}: could not attach DON!! to the leader`);
    const after = getCardPower(r.state, char);
    if (after !== before) {
      throw new Error(
        `${leader} is NOT inert: attaching 1 DON!! to the leader moved a character's power ` +
          `${before} -> ${after}. Batch-2 DON!! puzzles need leader attachment to be a genuine waste.`,
      );
    }
    const types = [...new Set(getLegalCommands(s, SEAT).map((d) => d.type))].sort().join("+");
    if (types !== "attachDon+declareAttack+endTurn") {
      throw new Error(`${leader} adds unexpected legal commands: ${types}`);
    }
  }

  // 3. The powers the puzzle prose quotes must be the powers the engine plays. OP13-003 prints 7000
  //    and plays at 9000, so a printed value is not evidence.
  const expected: Array<[string, number]> = [
    [LEAD_INERT_5000, 5000],
    [LEAD_INERT_5000B, 5000],
    [LEAD_INERT_6000, 6000],
  ];
  for (const [leader, power] of expected) {
    const e = OnePieceTestEngine.create(
      { leaderCardId: LEAD_INERT_5000, deck: 20, hand: 0 },
      { leaderCardId: leader, deck: 20, hand: 0, life: 2 },
      { activeSeat: SEAT, firstPlayer: "north" },
    );
    const s = e.getState();
    const actual = getCardPower(s, s.players[OPP].leaderInstanceId);
    if (actual !== power)
      throw new Error(`${leader} plays at ${actual}, not the ${power} the puzzles assume`);
  }

  const bodies: Array<[string, number]> = [
    [V3000, 3000],
    [V4000, 4000],
    [V5000, 5000],
    [V6000, 6000],
    [V7000, 7000],
    [V8000, 8000],
    [V9000, 9000],
  ];
  for (const [id, power] of bodies) {
    const e = OnePieceTestEngine.create(
      {
        leaderCardId: LEAD_INERT_5000,
        deck: 20,
        hand: 0,
        character: [{ cardId: id, playedOnTurn: 0 }],
      },
      { leaderCardId: LEAD_INERT_5000B, deck: 20, hand: 0, life: 2 },
      { activeSeat: SEAT, firstPlayer: "north" },
    );
    const s = e.getState();
    const inst = s.players[SEAT].characterArea.find(Boolean)!;
    const actual = getCardPower(s, inst);
    if (actual !== power)
      throw new Error(`${id} plays at ${actual}, not the ${power} the puzzles assume`);
    if (getKeywords(s, inst).size !== 0)
      throw new Error(`${id} is not vanilla: keywords ${[...getKeywords(s, inst)].join(",")}`);
  }
});

/**
 * The MECHANISM behind every koVsDamage failure, pinned at the API rather than inferred from a
 * puzzle score. A puzzle can fail for many reasons; this can only fail if target choice becomes
 * reachable. Kept next to the puzzles so the two move together.
 */
run("no ladder strategy can choose an attack target", () => {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: LEAD_INERT_5000,
      deck: 20,
      hand: 0,
      character: [{ cardId: V8000, playedOnTurn: 0 }],
    },
    {
      leaderCardId: LEAD_INERT_5000B,
      deck: 20,
      hand: 0,
      life: 3,
      character: [{ cardId: V4000, rested: true, playedOnTurn: 0 }],
    },
    { activeSeat: SEAT, firstPlayer: "north" },
  );
  const s = engine.getState();
  const legal = getLegalCommands(s, SEAT);

  // The choice genuinely exists in the descriptor: one attacker, two targets.
  const attack = legal.find(
    (d) => d.type === "declareAttack" && d.sourceId === s.players[SEAT].characterArea.find(Boolean),
  );
  if (!attack || (attack.targetIds ?? []).length < 2) {
    throw new Error(
      `fixture drift: expected one declareAttack descriptor carrying >=2 targets, got ${JSON.stringify(attack?.targetIds)}`,
    );
  }
  const leaderId = s.players[OPP].leaderInstanceId;
  if (attack.targetIds?.[0] !== leaderId) {
    throw new Error("fixture drift: legalAttackTargets no longer puts the defending leader first");
  }

  // commandFromDescriptor collapses that choice to targetIds[0] no matter what.
  const collapsed = commandFromDescriptor(s, SEAT, attack, { random: () => 0.99 });
  if (collapsed?.type !== "declareAttack" || collapsed.targetId !== leaderId) {
    throw new Error(
      `commandFromDescriptor no longer pins the target to targetIds[0] — got ${JSON.stringify(collapsed)}`,
    );
  }

  // And therefore no strategy, sampled hard with varied randomness, ever names the character.
  const bodyId = s.players[OPP].characterArea.find(Boolean)!;
  for (const [name, strategy] of LADDER) {
    for (let i = 0; i < 200; i++) {
      const cmd = strategy(s, SEAT, legal, { random: () => (i * 0.37 + 0.13) % 1 });
      if (cmd?.type === "declareAttack" && cmd.targetId === bodyId) {
        throw new Error(
          `${name} chose a CHARACTER target — target selection is reachable now, so the koVsDamage puzzles must be re-scored as policy measurements`,
        );
      }
    }
  }
});

/**
 * TASK 5 -- THE PROMPT RESOLVER, NOT THE POLICY. Reported apart and never folded into the ladder
 * totals, because `runBotMatch` resolves a pending prompt via `resolveBotPromptCommand(state,
 * prompt)`, which never receives the strategy at all (bot-harness.ts). Counter play and blocker use
 * are defender-side prompts, so they are not policy decisions in this engine and a puzzle about
 * them would measure the wrong thing.
 *
 * Both prompts are built with `minSelections: 0` -- the counter step in battle.ts and the block step
 * in engine/queue.ts -- and the resolver's selectCards branch takes
 * `Math.min(maxSelections, minSelections)`, which is therefore ALWAYS 0. The bot can never counter
 * and can never block. That is asserted here rather than described, because it silently biases every
 * simulated matchup: combat resolves on printed power plus DON!! alone, with no defensive
 * interaction of any kind.
 */
run("the prompt resolver never counters and never blocks", () => {
  // --- counter: a defender holding real counter cards still takes the damage.
  for (const handSize of [1, 3]) {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: LEAD_INERT_5000,
        deck: 20,
        life: 3,
        hand: Array.from({ length: handSize }, () => ({ cardId: V5000 })),
      },
      { leaderCardId: LEAD_INERT_5000B, deck: 20, life: 3, hand: 0 },
      { activeSeat: OPP, firstPlayer: SEAT },
    );
    const s = engine.getState();
    const lifeBefore = s.players[SEAT].life.length;
    const r = applyCommand(s, {
      type: "declareAttack",
      seat: OPP,
      attackerId: s.players[OPP].leaderInstanceId,
      targetId: s.players[SEAT].leaderInstanceId,
    } as EngineCommand);
    if (!r.accepted) throw new Error(`fixture drift: the attack was rejected (${r.reason})`);

    const prompt = r.state.promptQueue.find((e) => e.status === "pending");
    if (!prompt || prompt.choiceKind !== "selectCards") {
      throw new Error(
        `fixture drift: expected a pending selectCards counter prompt, got ${prompt?.choiceKind ?? "none"}`,
      );
    }
    if (prompt.minSelections !== 0) {
      throw new Error(
        `the counter prompt's minSelections is ${prompt.minSelections}, not 0 — the never-counters result depended on it being 0`,
      );
    }
    const chosen = resolveBotPromptCommand(r.state, prompt) as { selectedIds?: string[] } | null;
    if (chosen?.selectedIds?.length !== 0) {
      throw new Error(
        `the resolver now selects ${JSON.stringify(chosen?.selectedIds)} counters — every measurement taken before this change assumed zero`,
      );
    }
    const after = drainPrompts(r.state).state;
    if (after.players[SEAT].life.length !== lifeBefore - 1) {
      throw new Error(
        `expected the uncountered attack to cost exactly 1 life, saw ${lifeBefore} -> ${after.players[SEAT].life.length}`,
      );
    }
  }

  // --- blocker: an ACTIVE character with the real [Blocker] keyword is offered and declined.
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: LEAD_INERT_5000,
      deck: 20,
      life: 3,
      hand: 0,
      character: [{ cardId: BLOCKER, playedOnTurn: 0 }],
    },
    { leaderCardId: LEAD_INERT_5000B, deck: 20, life: 3, hand: 0 },
    { activeSeat: OPP, firstPlayer: SEAT },
  );
  const s = engine.getState();
  const blockerId = s.players[SEAT].characterArea.find(Boolean)!;
  if (!getKeywords(s, blockerId).has("blocker")) {
    throw new Error(`fixture drift: ${BLOCKER} no longer has the blocker keyword`);
  }
  const lifeBefore = s.players[SEAT].life.length;
  const r = applyCommand(s, {
    type: "declareAttack",
    seat: OPP,
    attackerId: s.players[OPP].leaderInstanceId,
    targetId: s.players[SEAT].leaderInstanceId,
  } as EngineCommand);
  if (!r.accepted) throw new Error(`fixture drift: the attack was rejected (${r.reason})`);
  const prompt = r.state.promptQueue.find((e) => e.status === "pending");
  if (!prompt || !(prompt.options ?? []).some((o) => o.id === blockerId)) {
    throw new Error(
      `fixture drift: the block prompt did not offer the blocker (${prompt?.choiceKind ?? "no prompt"})`,
    );
  }
  const chosen = resolveBotPromptCommand(r.state, prompt) as { selectedIds?: string[] } | null;
  if (chosen?.selectedIds?.length !== 0) {
    throw new Error(
      `the resolver now selects a blocker (${JSON.stringify(chosen?.selectedIds)}) — every measurement taken before this change assumed it never blocks`,
    );
  }
  const after = drainPrompts(r.state).state;
  if (after.players[SEAT].life.length !== lifeBefore - 1 || after.cards[blockerId]?.rested) {
    throw new Error(
      `expected the block to be declined and 1 life lost, saw life ${lifeBefore} -> ${after.players[SEAT].life.length}, blocker rested=${after.cards[blockerId]?.rested}`,
    );
  }
});

// Review finding on batch 2 Task 1: all 6 puzzles above are vanilla-body positions with zero
// pending prompts by construction (see adjudicate()'s docstring), so the suite above only ever
// exercises drainPrompts' `if (!prompt) return` no-op branch on the first loop iteration -- never
// the actual resolve-a-prompt body, its state threading, or its `drained` flag. This is separate
// from the PUZZLES table on purpose: it is not a policy measurement (nothing here is scored
// against the ladder), so it must not add a row to that table or move byClass's totals. It reuses
// the SHIPPED drainPrompts directly, not a copy, so a future edit to the real function is covered.
//
// OP16-118 Portgas.D.Ace's [On Play] is a real two-prompt cascade, confirmed by manual
// instrumentation before writing this test (not committed, run against the vendored engine):
// resolving the first prompt (effectSearchSelection, choiceKind "selectCards") is what CAUSES the
// second (effectSearchRemainderOrder, choiceKind "orderCards") to become pending -- it does not
// exist until the first is resolved. So a loop that only fires once, or one that stops threading
// `current` between iterations (e.g. re-reads the pre-loop state instead of the post-applyCommand
// one), cannot pass this: it will either leave the second prompt pending (caught by the
// `pendingAfter` assertion) or hand `resolveBotPromptCommand` a prompt id that state has already
// marked resolved, which `applyCommand` rejects and `drainPrompts` turns into a thrown "stalled"
// error (caught because the test does not wrap the call in a try/catch).
run("drainPrompts resolves a real multi-prompt cascade (not just the no-op branch)", () => {
  const engine = OnePieceTestEngine.create(
    {
      leaderCardId: op16PortgasDAce001,
      hand: [op16PortgasDAce118],
      deck: [op01Sai012, op01Sai012, op01Sai012, op01Sai012, op01Sai012, op01Sai012],
      activeDon: op16PortgasDAce118.cost,
    },
    {},
  );
  engine.playCard(op16PortgasDAce118, "south");
  const midState = engine.getState();
  const deckSizeBefore = midState.players.south.deck.length;

  const pendingBefore = midState.promptQueue.filter((entry) => entry.status === "pending");
  if (pendingBefore.length !== 1 || pendingBefore[0]?.choiceKind !== "selectCards") {
    throw new Error(
      `fixture drift: expected exactly one pending "selectCards" prompt before draining, got ${JSON.stringify(
        pendingBefore.map((p) => p.choiceKind),
      )} -- this test needs Ace's search to still open with a selectCards prompt`,
    );
  }

  const result = drainPrompts(midState);

  if (!result.drained) throw new Error("drainPrompts reported drained=false on a real cascade");
  const pendingAfter = result.state.promptQueue.filter((entry) => entry.status === "pending");
  if (pendingAfter.length !== 0) {
    throw new Error(
      `drainPrompts left ${pendingAfter.length} prompt(s) pending -- the second (orderCards)` +
        ` prompt only appears after the first is resolved, so this means the loop did not` +
        ` iterate past its first pass`,
    );
  }
  // Both the selectCards prompt AND the orderCards prompt it triggers must show resolved -- not
  // just "no longer pending" -- so this fails if some third status leaks in some way "0 pending"
  // would miss, and it documents that TWO real resolutions, not one, were required to get here.
  const resolvedCount = result.state.promptQueue.filter(
    (entry) => entry.status === "resolved",
  ).length;
  if (resolvedCount !== 2) {
    throw new Error(`expected exactly 2 resolved prompts (the cascade), got ${resolvedCount}`);
  }
  // Coarse state-integrity check: draining two prompts must reorder the deck, never lose or
  // duplicate cards.
  if (result.state.players.south.deck.length !== deckSizeBefore) {
    throw new Error(
      `deck size changed across drain (${deckSizeBefore} -> ${result.state.players.south.deck.length}) -- state threading likely corrupted the line`,
    );
  }
});
