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
import { applyCommand, createMatch, getLegalCommands } from "../../src/core.ts";
import {
  valueRankedStrategy,
  greedyStrategy,
  randomStrategy,
  firstLegalStrategy,
  passOnlyStrategy,
  commandFromDescriptor,
} from "../../src/automation/bot-strategies.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";
import { resolveBotPromptCommand, runBotMatch } from "../../src/automation/bot-harness.ts";
import {
  COUNTER_POLICY_DEFAULTS,
  counterPolicyConfig,
  decideCounter,
  setCounterPolicyConfig,
} from "../../src/automation/counter-policy.ts";
import { OnePieceTestEngine } from "../../src/index.ts";
import { getCardPower, getKeywords } from "../../src/shared.ts";
import type {
  EngineCommand,
  MatchConfig,
  MatchSeat,
  MatchState,
  PromptState,
} from "../../src/types.ts";

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
// An Event whose printed [Trigger] is "Draw 1 card." -- used as a LIFE card to pin the
// resolver's Trigger choice (Task 1.3). Chosen for being harmless; it is never resolved.
const TRIGGER_LIFE_CARD = "EB02-030";

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
 * TASK 1.1 -- NEITHER PLAYER MAY ATTACK ON THEIR OWN FIRST TURN.
 *
 * The Official Rule Manual's Battle Flow footnote is "Neither player can attack on their first
 * turn." `canAttackWith` gated only the FIRST player, and turn numbering is per PLAYER-turn, so the
 * second player's own first turn is `turnNumber === 2` and it went through. The engine fix is
 * `battle: neither player may attack on their own first turn` in tools/patch_engine.py.
 *
 * THIS PROBE WALKS A REAL MATCH, not a fixture, and that is the point. A fixture materialises a
 * mid-game board with its turn counter stuck at 1, so `test-fixtures.ts` sets
 * `allowFirstTurnAttacks: true` (alongside the three other opening rules it already suspends) --
 * without which 39 card tests in 31 files fail with "The selected attacker cannot attack." So no
 * fixture can exercise the ban, and only a match driven through joKenPo, mulligan and startGame
 * can. The second assertion below pins the fixture flag itself, so deleting it fails loudly here
 * instead of silently reverting those 39 tests.
 */
const PROBE_DECK = [V3000, V4000, V5000, V6000];

function probeConfig(firstPlayer: MatchSeat): MatchConfig {
  const deck = Array.from({ length: 50 }, (_, i) => PROBE_DECK[i % PROBE_DECK.length]!);
  return {
    firstPlayer,
    seed: "first-turn-attack-probe",
    shuffleDecks: true,
    openingHandSize: 5,
    skipFirstTurnDraw: true,
    maxCharacterSlots: 5,
    players: {
      south: { leaderCardId: LEAD_INERT_5000, mainDeck: deck, playerName: "SouthProbe" },
      north: { leaderCardId: LEAD_INERT_5000B, mainDeck: deck, playerName: "NorthProbe" },
    },
  };
}

interface ProbeRow {
  turn: number;
  seat: MatchSeat;
  offered: boolean;
}

/**
 * Drive a real match to `active`, then report for each of the first four player-turns whether the
 * active seat is offered a declareAttack.
 *
 * `config.firstPlayer` is NOT what decides who leads -- the joKenPo winner's `chooseFirstPlayer`
 * overwrites it (CLAUDE.md). So the setup driver deliberately picks the descriptor naming the seat
 * this probe wants leading, which is how one probe can cover both seats in both roles, and the
 * table reports the post-setup value rather than the requested one.
 */
function firstTurnAttackProbe(desiredFirst: MatchSeat): {
  firstPlayer: MatchSeat;
  rows: ProbeRow[];
} {
  let state = createMatch(probeConfig(desiredFirst));
  for (let guard = 0; guard <= MAX_TURN_STEPS * 2; guard++) {
    if (state.status !== "setup") break;
    if (guard === MAX_TURN_STEPS * 2) throw new Error("setup did not finish");
    const drained = drainPrompts(state);
    state = drained.state;
    if (state.status !== "setup") break;
    const legal = [...getLegalCommands(state, "south"), ...getLegalCommands(state, "north")];
    const actor = legal.find((d) => d.seat === "south" || d.seat === "north");
    if (!actor) throw new Error("setup stalled: no seat has a legal command");
    const seat = actor.seat as MatchSeat;
    const mine = legal.filter((d) => d.seat === seat);
    const chosenFirst = mine.find(
      (d) => d.type === "chooseFirstPlayer" && d.targetIds?.[0] === desiredFirst,
    );
    const cmd = chosenFirst
      ? commandFromDescriptor(state, seat, chosenFirst)
      : passOnlyStrategy(state, seat, mine);
    if (!cmd) throw new Error(`setup stalled: no command for ${seat}`);
    const r = applyCommand(state, cmd);
    if (!r.accepted) throw new Error(`setup stalled: ${cmd.type} rejected (${r.reason})`);
    state = r.state;
  }
  if (state.status !== "active") throw new Error(`setup ended in status ${state.status}`);

  const firstPlayer = state.config.firstPlayer;
  const rows: ProbeRow[] = [];
  for (let i = 0; i < 4; i++) {
    const drained = drainPrompts(state);
    state = drained.state;
    const seat = state.activeSeat;
    rows.push({
      turn: state.turnNumber,
      seat,
      offered: getLegalCommands(state, seat).some((d) => d.type === "declareAttack"),
    });
    const r = applyCommand(state, { type: "endTurn", seat } as EngineCommand);
    if (!r.accepted) throw new Error(`turn ${state.turnNumber}: endTurn rejected (${r.reason})`);
    state = r.state;
  }
  return { firstPlayer, rows };
}

run(
  "neither player may attack on their own first turn",
  () => {
    const failures: string[] = [];
    console.log("\nFIRST-TURN ATTACK BAN  (real match, driven through setup)");
    for (const desiredFirst of ["north", "south"] as MatchSeat[]) {
      const { firstPlayer, rows } = firstTurnAttackProbe(desiredFirst);
      console.log(`  firstPlayer=${firstPlayer}`);
      for (const row of rows) {
        const ownFirstTurn = row.turn === (row.seat === firstPlayer ? 1 : 2);
        const ok = row.offered === !ownFirstTurn;
        console.log(
          `    turn ${row.turn}  ${row.seat.padEnd(5)}  declareAttack offered=${String(row.offered).padEnd(5)}` +
            `  ${ownFirstTurn ? "(its own first turn)" : ""}  ${ok ? "" : "  <-- WRONG"}`,
        );
        if (!ok) {
          failures.push(
            `firstPlayer=${firstPlayer} turn ${row.turn} ${row.seat}: offered=${row.offered}, expected ${!ownFirstTurn}`,
          );
        }
      }
    }

    // The fixture escape hatch, asserted rather than assumed: 39 card tests in 31 files depend on it,
    // and it is the reason the probe above has to drive a real match.
    const fixture = OnePieceTestEngine.create({}, {}).getState();
    if (fixture.config.allowFirstTurnAttacks !== true) {
      failures.push(
        "test-fixtures.ts no longer sets allowFirstTurnAttacks -- 39 card tests in 31 files fail " +
          "with 'The selected attacker cannot attack.' without it (tools/patch_engine.py)",
      );
    }

    // And the arithmetic itself, seat by seat and turn by turn, with the fixture flag cleared. This
    // is the same rule the real match above exercises, stated as a table so a formulation that
    // happens to be right for one seat and wrong for the other cannot pass.
    console.log("  fixture probe with allowFirstTurnAttacks cleared:");
    for (const firstPlayer of ["north", "south"] as MatchSeat[]) {
      for (const turn of [1, 2, 3, 4]) {
        // Whose turn a given number is, if turns alternate from the first player.
        const seat: MatchSeat =
          turn % 2 === 1 ? firstPlayer : firstPlayer === "north" ? "south" : "north";
        const engine = OnePieceTestEngine.create(
          { leaderCardId: LEAD_INERT_5000, deck: 20, hand: 0 },
          { leaderCardId: LEAD_INERT_5000B, deck: 20, hand: 0 },
          { firstPlayer, activeSeat: seat },
        );
        const state = engine.getState();
        state.config.allowFirstTurnAttacks = undefined;
        state.turnNumber = turn;
        const offered = getLegalCommands(state, seat).some((d) => d.type === "declareAttack");
        const ownFirstTurn = turn === (seat === firstPlayer ? 1 : 2);
        console.log(
          `    first=${firstPlayer.padEnd(5)} turn ${turn}  ${seat.padEnd(5)}  offered=${String(offered).padEnd(5)}` +
            `  ${ownFirstTurn ? "(its own first turn)" : ""}`,
        );
        if (offered !== !ownFirstTurn) {
          failures.push(
            `fixture probe first=${firstPlayer} turn ${turn} ${seat}: offered=${offered}, expected ${!ownFirstTurn}`,
          );
        }
      }
    }

    if (failures.length) throw new Error(failures.join(" | "));
  },
  30_000,
);

// -------------------------------------------------------------------------------------------
// TASK 1.2 -- counterPlay. THE PROMPT RESOLVER, NOT A LADDER POLICY, and reported apart for the
// same reason the block below is: `runBotMatch` resolves a defender-side prompt through
// `resolveBotPromptCommand(state, prompt)`, which never sees a strategy at all. Scoring these
// against the ladder would be a category error, so they get their own table and their own totals.
//
// Before `counter-policy.ts` the bot never countered: the resolver's selectCards branch takes
// `Math.min(maxSelections, minSelections)` and the counter prompt is built with
// `minSelections: 0`. Damage is BINARY (`attackPower >= defensePower`, ties to the attacker), so a
// counter either flips the battle or is entirely wasted -- there is no "counter harder" axis.
//
// WHAT IS ASSERTED HERE IS ONLY THE THRESHOLD-FREE PART: never spend a counter that cannot flip the
// battle, always counter lethal, spend the fewest cards that do flip it, and tank while life is
// comfortably above the opponent's attacker horizon. The R rule's middle -- exactly where tanking
// turns into countering -- is OPINION, calibrated by `avgCost`, and Phase 3 measures it. Pinning it
// with an assertion here would freeze a knob that is meant to move, so `avgCostSweep` instead
// requires the answer to hold across the whole knob range.
//
// EVERY ANSWER IS ADJUDICATED BY THE ENGINE. The candidate selections below are applied through
// `applyCommand` and the outcome is read out of the resulting state; "minimal spend" is the minimum
// over the selections the ENGINE reports as surviving, never a hand-written notion of which card is
// right.

interface CounterPuzzle {
  id: string;
  why: string;
  /** Who swings, and at what. The defender is always SEAT. */
  attacker: "leader" | "character";
  target: "leader" | "character";
  /**
   * A property of the POSITION, proved by enumeration before the policy is asked anything:
   * "flippable" -- some selection saves the defender, so declining is a real decision;
   * "unflippable" -- none can, so spending anything is provably waste.
   */
  requires: "flippable" | "unflippable";
  answer: "spend-nothing" | "survive-minimal";
  build: () => OnePieceTestEngine;
  /** avgCost values the answer must hold for, so the assertion is not pinned to the knob's default. */
  avgCostSweep?: number[];
}

interface CounterOutcome {
  /** Instance ids that left the defender's hand. Tracked by id because taking damage ADDS the life
   *  card to hand, so a size comparison would be wrong. */
  spent: string[];
  lifeLost: number;
  lost: boolean;
  bodyLost: boolean;
  /** The attack accomplished nothing. */
  flipped: boolean;
}

/** Declare the attack and stop at the counter prompt. */
function openCounterPrompt(p: CounterPuzzle): {
  state: MatchState;
  prompt: PromptState;
  handBefore: string[];
  lifeBefore: number;
  bodiesBefore: number;
} {
  const state = p.build().getState();
  const handBefore = [...state.players[SEAT].hand];
  const lifeBefore = state.players[SEAT].life.length;
  const bodiesBefore = state.players[SEAT].characterArea.filter(Boolean).length;
  const attackerId =
    p.attacker === "leader"
      ? state.players[OPP].leaderInstanceId
      : state.players[OPP].characterArea.find(Boolean)!;
  const targetId =
    p.target === "leader"
      ? state.players[SEAT].leaderInstanceId
      : state.players[SEAT].characterArea.find(Boolean)!;
  const r = applyCommand(state, {
    type: "declareAttack",
    seat: OPP,
    attackerId,
    targetId,
  } as EngineCommand);
  if (!r.accepted) throw new Error(`${p.id}: fixture drift -- attack rejected (${r.reason})`);
  const prompt = r.state.promptQueue.find((entry) => entry.status === "pending");
  if (!prompt || prompt.resolutionContext?.intent !== "battleCounter") {
    throw new Error(
      `${p.id}: fixture drift -- expected a pending battleCounter prompt, got ` +
        `${prompt?.resolutionContext?.intent ?? "none"}`,
    );
  }
  // The defect the policy exists for: minSelections 0 is what made the resolver's default branch
  // select nothing. If upstream ever changes it, the policy is no longer the thing being measured.
  if (prompt.minSelections !== 0) {
    throw new Error(
      `${p.id}: the counter prompt's minSelections is ${prompt.minSelections}, not 0`,
    );
  }
  return { state: r.state, prompt, handBefore, lifeBefore, bodiesBefore };
}

function counterOutcome(
  p: CounterPuzzle,
  after: MatchState,
  handBefore: string[],
  lifeBefore: number,
  bodiesBefore: number,
): CounterOutcome {
  const hand = after.players[SEAT].hand;
  const spent = handBefore.filter((id) => !hand.includes(id));
  const lifeLost = lifeBefore - after.players[SEAT].life.length;
  const bodyLost = after.players[SEAT].characterArea.filter(Boolean).length < bodiesBefore;
  const lost = after.winner === OPP;
  return {
    spent,
    lifeLost,
    lost,
    bodyLost,
    flipped: p.target === "leader" ? lifeLost === 0 && !lost : !bodyLost,
  };
}

/** Resolve the counter prompt with an explicit selection. null = the engine rejected it, so it is
 *  not a line the defender could have played. */
function counterWith(p: CounterPuzzle, selectedIds: string[]): CounterOutcome | null {
  const opened = openCounterPrompt(p);
  const r = applyCommand(opened.state, {
    type: "resolvePrompt",
    seat: SEAT,
    promptId: opened.prompt.id,
    selectedIds,
  } as EngineCommand);
  if (!r.accepted) return null;
  const after = drainPrompts(r.state).state;
  return counterOutcome(p, after, opened.handBefore, opened.lifeBefore, opened.bodiesBefore);
}

/** Every selection the defender could submit, up to 3 cards. Hands in these positions are 1-3
 *  cards, so this is the whole space, not a sample. */
function counterSelections(prompt: PromptState): string[][] {
  const ids = prompt.options.map((o) => o.id);
  const out: string[][] = [[]];
  for (let i = 0; i < ids.length; i++) {
    out.push([ids[i]!]);
    for (let j = i + 1; j < ids.length; j++) {
      out.push([ids[i]!, ids[j]!]);
      for (let k = j + 1; k < ids.length; k++) out.push([ids[i]!, ids[j]!, ids[k]!]);
    }
  }
  return out;
}

function counterSatisfies(p: CounterPuzzle, out: CounterOutcome, minimalSpend: number): boolean {
  switch (p.answer) {
    case "spend-nothing":
      return out.spent.length === 0;
    case "survive-minimal":
      return !out.lost && out.flipped && out.spent.length === minimalSpend;
  }
}

const COUNTER_PUZZLES: CounterPuzzle[] = [
  {
    id: "counter-cannot-flip",
    why: "A 9000 body swings at a 5000 Leader on 0 life: 4001 power is needed and the whole hand adds 2000. Damage is binary, so every non-empty selection trashes cards and loses anyway. The 0 life is what makes this a test of the never-waste rule rather than of the tank rule -- at 3 life the policy declines for the R reason and the position cannot see a broken sufficiency test at all (found by mutation, see docs/simulation.md).",
    attacker: "character",
    target: "leader",
    requires: "unflippable",
    answer: "spend-nothing",
    build: () =>
      counterBoard(
        { life: 0, hand: [V5000, V5000] },
        { character: [{ cardId: V9000, playedOnTurn: 0 }] },
      ),
  },
  {
    id: "counter-lethal-must-flip",
    why: "South is on 0 life, so taking Leader damage ends the game (battle.ts declares the attacker the winner). 5000 into 5000 connects on the tie; 1000 of counter is enough to survive it.",
    attacker: "leader",
    target: "leader",
    requires: "flippable",
    answer: "survive-minimal",
    build: () => counterBoard({ life: 0, hand: [V5000] }, {}),
  },
  {
    id: "counter-lethal-cheapest",
    why: "Same lethal, but two identical counters in hand. One flips the battle, so spending both is a card thrown away -- lethal forces the counter, which is what makes 'fewest cards' assertable without touching the R rule.",
    attacker: "leader",
    target: "leader",
    requires: "flippable",
    answer: "survive-minimal",
    build: () => counterBoard({ life: 0, hand: [V5000, V5000] }, {}),
  },
  {
    id: "counter-tank-early",
    why: "South is on 4 life against an empty board and 2 DON!!, so the opponent's attacker horizon is 1-3 depending on avgCost and the hit costs one life card that goes straight to HAND, usable as a counter later. Countering here spends a card to save one it would have drawn.",
    attacker: "leader",
    target: "leader",
    requires: "flippable",
    answer: "spend-nothing",
    // The whole plausible range of the knob. If tank-early only held at the default, this would be
    // an assertion about avgCost rather than about the policy.
    avgCostSweep: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    build: () => counterBoard({ life: 4, hand: [V5000] }, { activeDon: 2 }),
  },
];

/**
 * A counter position: NORTH is to move and swings, SOUTH defends. Life is set explicitly to
 * trigger-less vanilla bodies -- a life card with a [Trigger] routes to `resolution` and opens
 * another prompt, which would fold a second resolver decision into a counter measurement.
 */
function counterBoard(south: object, north: object): OnePieceTestEngine {
  return OnePieceTestEngine.create(
    { leaderCardId: LEAD_INERT_5000, deck: 20, life: [V5000, V5000, V5000, V5000], ...south },
    { leaderCardId: LEAD_INERT_5000B, deck: 20, hand: 0, life: 4, ...north },
    { activeSeat: OPP, firstPlayer: SEAT },
  );
}

run(
  "counterPlay (prompt resolver, not scored as policy)",
  () => {
    console.log(
      `\nCOUNTER PLAY  ${COUNTER_PUZZLES.length} positions   ` +
        `defaults: ${JSON.stringify(COUNTER_POLICY_DEFAULTS)}`,
    );
    const defects: string[] = [];
    const failures: string[] = [];

    for (const p of COUNTER_PUZZLES) {
      const opened = openCounterPrompt(p);
      const selections = counterSelections(opened.prompt);
      const played = selections
        .map((sel) => ({ sel, out: counterWith(p, sel) }))
        .filter((entry): entry is { sel: string[]; out: CounterOutcome } => entry.out !== null);
      const flipping = played.filter((entry) => entry.out.flipped);
      const minimalSpend = flipping.length
        ? Math.min(...flipping.map((entry) => entry.out.spent.length))
        : 0;

      // The position's own property, proved rather than asserted in prose.
      if (p.requires === "flippable" && flipping.length === 0) {
        defects.push(
          `${p.id}: NOT FLIPPABLE -- no selection saves the defender, so nothing is asked`,
        );
      }
      if (p.requires === "unflippable" && flipping.length > 0) {
        defects.push(
          `${p.id}: FLIPPABLE -- a counter does save the defender here, so 'never waste' is not what this position tests`,
        );
      }
      const solvable = played.filter((entry) =>
        counterSatisfies(p, entry.out, minimalSpend),
      ).length;
      if (solvable === 0) defects.push(`${p.id}: BROKEN -- no selection satisfies the answer`);
      if (solvable === played.length)
        defects.push(`${p.id}: VACUOUS -- every legal selection satisfies the answer`);

      // What the SHIPPED resolver does, through the same call runBotMatch makes.
      const sweep = p.avgCostSweep ?? [COUNTER_POLICY_DEFAULTS.avgCost];
      const cells: string[] = [];
      for (const avgCost of sweep) {
        setCounterPolicyConfig({ avgCost });
        try {
          const fresh = openCounterPrompt(p);
          const decision = decideCounter(fresh.state, fresh.prompt);
          const cmd = resolveBotPromptCommand(fresh.state, fresh.prompt);
          if (!cmd) throw new Error(`${p.id}: the resolver returned no command`);
          const r = applyCommand(fresh.state, cmd);
          if (!r.accepted) {
            failures.push(`${p.id}: the resolver's own command was illegal (${r.reason})`);
            continue;
          }
          const out = counterOutcome(
            p,
            drainPrompts(r.state).state,
            fresh.handBefore,
            fresh.lifeBefore,
            fresh.bodiesBefore,
          );
          const ok = counterSatisfies(p, out, minimalSpend);
          cells.push(`${avgCost}:${ok ? "pass" : "FAIL"}/${decision.reason}`);
          if (!ok) {
            failures.push(
              `${p.id} (avgCost=${avgCost}): spent ${out.spent.length}, lifeLost ${out.lifeLost}, ` +
                `lost=${out.lost}, reason=${decision.reason}, minimal spend is ${minimalSpend} -- ${p.why}`,
            );
          }
        } finally {
          setCounterPolicyConfig(null);
        }
      }
      console.log(
        `  ${p.id.padEnd(26)} ${p.answer.padEnd(16)} ${p.requires.padEnd(12)} ` +
          `solvable ${solvable}/${played.length}  minimal=${minimalSpend}  ${cells.join("  ")}`,
      );
    }

    // THE SWEEP MECHANISM ITSELF. Phase 3 varies these knobs from outside the process, so the env
    // path is load-bearing in a way a default is not: if OPCG_COUNTER_AVG_COST stops being read, a
    // 15-bucket sweep silently becomes fifteen runs of the same policy and still prints a table.
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const env = proc?.env;
    if (!env) {
      failures.push("no process.env in this runtime -- the Phase 3 sweep has no way in");
    } else {
      const restore = env.OPCG_COUNTER_AVG_COST;
      try {
        env.OPCG_COUNTER_AVG_COST = "9";
        if (counterPolicyConfig().avgCost !== 9) {
          failures.push(
            `OPCG_COUNTER_AVG_COST=9 read back as ${counterPolicyConfig().avgCost} -- the env knob is not wired`,
          );
        }
        // A typo must not silently become NaN and take the R rule with it.
        env.OPCG_COUNTER_AVG_COST = "not-a-number";
        if (counterPolicyConfig().avgCost !== COUNTER_POLICY_DEFAULTS.avgCost) {
          failures.push(
            `an unparseable OPCG_COUNTER_AVG_COST gave ${counterPolicyConfig().avgCost}, not the default`,
          );
        }
        // The in-process override wins, which is what lets a puzzle pin a knob without exporting one.
        env.OPCG_COUNTER_AVG_COST = "9";
        setCounterPolicyConfig({ avgCost: 2 });
        if (counterPolicyConfig().avgCost !== 2) {
          failures.push("setCounterPolicyConfig no longer takes precedence over the environment");
        }
      } finally {
        setCounterPolicyConfig(null);
        if (restore === undefined) delete env.OPCG_COUNTER_AVG_COST;
        else env.OPCG_COUNTER_AVG_COST = restore;
      }
    }

    // END TO END, and labelled a WIRING CHECK rather than a measurement: a counter selection the
    // engine rejects aborts the game with `illegal-command`, which is exactly how the orderCards and
    // search-to-hand defects presented. Real 50-card decks driven through real setup. No win rate is
    // read off this -- that is Phase 2, deliberately batched. The two `firstPlayer` values produce
    // IDENTICAL games at a given seed, which is not a bug in the loop: `config.firstPlayer` is
    // overwritten by the joKenPo winner's `chooseFirstPlayer` (CLAUDE.md), and that is exactly why
    // the probe above picks that command deliberately instead of trusting the config.
    for (const firstPlayer of ["north", "south"] as MatchSeat[]) {
      for (const seed of ["counter-wiring-1", "counter-wiring-2"]) {
        const result = runBotMatch(
          { ...probeConfig(firstPlayer), seed },
          { south: valueRankedStrategy, north: valueRankedStrategy },
          { maxCommands: 400, seed },
        );
        console.log(
          `  runBotMatch first=${firstPlayer} seed=${seed}: ${result.termination}` +
            ` winner=${result.winner ?? "none"} cmds=${result.totalCommands} illegal=${result.illegalCommands}`,
        );
        if (result.illegalCommands !== 0 || result.termination === "illegal-command") {
          failures.push(
            `runBotMatch(first=${firstPlayer}, seed=${seed}) hit ${result.illegalCommands} illegal ` +
              `command(s), termination=${result.termination} -- a counter selection the engine refuses`,
          );
        }
      }
    }

    // The master switch has to reproduce the old behaviour exactly, or the Phase 2 re-measure has no
    // control arm to compare against.
    setCounterPolicyConfig({ enabled: false });
    try {
      for (const p of COUNTER_PUZZLES) {
        const opened = openCounterPrompt(p);
        const cmd = resolveBotPromptCommand(opened.state, opened.prompt) as {
          selectedIds?: string[];
        } | null;
        if (cmd?.selectedIds?.length !== 0) {
          failures.push(
            `${p.id}: with enabled:false the resolver selected ${JSON.stringify(cmd?.selectedIds)}, ` +
              `not [] -- the never-counter control arm is broken`,
          );
        }
      }
    } finally {
      setCounterPolicyConfig(null);
    }

    if (defects.length) {
      console.log("\nCOUNTER SUITE DEFECTS (bugs in the positions, not in the policy):");
      for (const d of defects) console.log(`  ${d}`);
    }
    if (failures.length) {
      console.log("\nCOUNTER POLICY FAILURES:");
      for (const f of failures) console.log(`  ${f}`);
    }
    const all = [...defects, ...failures];
    if (all.length) throw new Error(all.join(" | "));
  },
  30_000,
);

/**
 * TASK 1.3 -- THE TWO OPEN POLICY SURFACES, PINNED RATHER THAN FIXED.
 *
 * Both live in `resolveBotPromptCommand`, not in any strategy, so neither is a policy decision in
 * this engine and neither is scored against the ladder. They are deliberately NOT fixed -- see
 * docs/simulation.md, "Open policy surfaces":
 *
 *   BLOCKING has no waste-free rule. Countering is binary and either flips the battle or does
 *   nothing, so "never spend a counter that does not flip it" is a rule with no free parameter.
 *   Blocking trades a permanent body for roughly two cards of hand and redirects the attack; there
 *   is no threshold at which it is provably right, so a heuristic here would be an opinion shipped
 *   as a fix.
 *
 *   DECLINING A [TRIGGER] is a genuine value call. The Official Rule Manual makes it a choice: the
 *   life card either resolves its [Trigger] or goes to hand unrevealed. The resolver's confirm
 *   branch takes `activate` unconditionally, so the bot never banks a Trigger card. Whether that is
 *   right depends on the card, which is exactly why it is a surface and not a bug.
 *
 * The counter step USED to be pinned here too, as "never counters". It is now a real policy, and
 * its assertions live in the counterPlay block above.
 */
run("the prompt resolver never blocks, and always activates a [Trigger]", () => {
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

  // --- trigger: the life card on top carries a real printed [Trigger], both options are offered,
  //     and the resolver takes `activate` every time. The command is NOT applied: what is pinned is
  //     the CHOICE, not what EB02-030's "Draw 1 card." then does.
  const triggerEngine = OnePieceTestEngine.create(
    {
      leaderCardId: LEAD_INERT_5000,
      deck: 20,
      hand: 0,
      life: [TRIGGER_LIFE_CARD, V5000, V5000, V5000],
    },
    { leaderCardId: LEAD_INERT_5000B, deck: 20, hand: 0, life: 4 },
    { activeSeat: OPP, firstPlayer: SEAT },
  );
  const t = triggerEngine.getState();
  const tr = applyCommand(t, {
    type: "declareAttack",
    seat: OPP,
    attackerId: t.players[OPP].leaderInstanceId,
    targetId: t.players[SEAT].leaderInstanceId,
  } as EngineCommand);
  if (!tr.accepted) throw new Error(`fixture drift: the attack was rejected (${tr.reason})`);
  const triggerPrompt = tr.state.promptQueue.find((e) => e.status === "pending");
  if (triggerPrompt?.resolutionContext?.intent !== "lifeTrigger") {
    throw new Error(
      `fixture drift: expected a pending lifeTrigger prompt, got ` +
        `${triggerPrompt?.resolutionContext?.intent ?? "none"} — the defender's hand is empty, so no ` +
        `counter prompt should exist and the top life card must carry a [Trigger]`,
    );
  }
  if (triggerPrompt.sourceCardId !== TRIGGER_LIFE_CARD) {
    throw new Error(
      `fixture drift: the trigger prompt is for ${triggerPrompt.sourceCardId}, not ${TRIGGER_LIFE_CARD}`,
    );
  }
  const offered = triggerPrompt.options
    .map((o) => o.id)
    .sort()
    .join(",");
  if (offered !== "activate,skip") {
    throw new Error(`the [Trigger] prompt no longer offers a real choice: options ${offered}`);
  }
  const triggerChoice = resolveBotPromptCommand(tr.state, triggerPrompt) as {
    optionId?: string;
  } | null;
  if (triggerChoice?.optionId !== "activate") {
    throw new Error(
      `the resolver chose ${triggerChoice?.optionId} for a [Trigger] — declining is now reachable, ` +
        `so docs/simulation.md's "always activates a [Trigger]" is stale`,
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
