// Task 10: engine-bound batch execution, shared by the legacy direct-A/B CLI and the strict
// fixed-seat environment job adapter.
//
// VENDOR-RELATIVE IMPORTS, same convention as the pre-existing sim/matchup.sim.test.ts: this file
// is never executed from sim/ directly. scripts/simulate.sh copies it (unconditionally, for every
// mode) into the vendored engine's tests/cards/ directory alongside matchup.sim.test.ts,
// environment-contract.mjs, and (harness-tests mode only) batch-runner.test.ts and
// environment-job.sim.test.ts. Only once copied does `../../src/...` resolve to
// packages/engine/src/....
//
// Two families of primitives live here, deliberately kept separate rather than unified onto one
// code path:
//
//   LEGACY  (Deck, STRATEGIES, loadDeck, config, playOne, Summary, summarize, report, pairedDiff,
//            runLegacyMatchupCli) — moved verbatim from sim/matchup.sim.test.ts (Task 10 Step 4).
//            Behavior, output shape, and sim/results/last-run.json are unchanged, except that the
//            post-hoc turn threshold is now explicitly labelled legacy_turn_budget_proxy (it was
//            never a calibrated round timeout) and an invalid --first value now fails loudly
//            instead of silently becoming "alternate".
//
//   STRICT  (EngineDeckInput, BatchSpec, RawGameResult, runBatch, publishRawJobResultFile) — new
//            for the environment job adapter. runBatch never reads environment variables and never
//            writes files; it assigns north for "play", south for "draw", and alternates only when
//            explicitly asked (the legacy adapter's own use). Every game's aOnPlay is READ BACK from
//            final engine state, never assumed from the request.
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

// The engine resolves card ids through a runtime registry populated as a side effect of importing
// @tcg/op-cards. Imported for the value (allCards.length, catalog membership checks), not just the
// side effect, so it cannot be dropped as unused.
import { allCards } from "@tcg/op-cards";
import { runBotMatch } from "../../src/automation/bot-harness.ts";
import {
  greedyStrategy,
  valueRankedStrategy,
  randomStrategy,
  firstLegalStrategy,
  passOnlyStrategy,
} from "../../src/automation/bot-strategies.ts";
import { otherSeat } from "../../src/shared.ts";
import type { MatchConfig, MatchSeat } from "../../src/types.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";

import { classifyTermination, parseFirstPlayerValue } from "./environment-contract.mjs";

// ===========================================================================
// SHARED: strategy registry
// ===========================================================================

// MEASURED order, weakest -> strongest (policy_ladder.sh, 2026-08-19; see docs/simulation.md):
//   passOnly < random < firstLegal < greedy < valueRanked
export const STRATEGIES: Record<string, OnePieceBotStrategy> = {
  passOnly: passOnlyStrategy,
  firstLegal: firstLegalStrategy,
  random: randomStrategy,
  greedy: greedyStrategy,
  valueRanked: valueRankedStrategy,
};

export type StrategyName = keyof typeof STRATEGIES;

function pickStrategy(name: string): OnePieceBotStrategy {
  const found = STRATEGIES[name];
  if (!found) {
    throw new Error(`unknown strategy ${name}; have ${Object.keys(STRATEGIES).join(", ")}`);
  }
  return found;
}

// ===========================================================================
// LEGACY: deck loading, MatchConfig construction, single-game execution, and summary primitives.
// Moved from sim/matchup.sim.test.ts with behavior otherwise unchanged (Task 10 Step 4).
// ===========================================================================

export interface Deck {
  name: string;
  leader: string;
  /** 50 card ids, repeats included. */
  main: string[];
}

export interface GameResult {
  seed: number;
  /** Which seat deck A occupied. Alternated by index, which is what controls turn order. */
  aSeat: MatchSeat;
  /** Whether deck A was the first player in this game. */
  aOnPlay: boolean;
  /** Outcome for deck A. */
  outcome: "win" | "loss" | "timeout" | "unfinished";
  turns: number;
  commands: number;
  /** Why the game stopped, straight from the engine. */
  termination: string;
  stuck: boolean;
  /** Last command the engine accepted before it gave up — names the failing decision point. */
  lastCommand: string;
  /** The engine's own rejection text, when it abandoned the game. */
  rejection: string;
}

export function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function loadDeck(path: string): Deck {
  const deck = JSON.parse(readFileSync(path, "utf8")) as Deck;
  if (!deck.leader) throw new Error(`${path}: no leader`);
  if (!Array.isArray(deck.main)) throw new Error(`${path}: main is not an array`);
  // A legal deck is exactly 50 cards plus the leader (CLAUDE.md: an earlier draft said 51).
  // Warn rather than throw — a deliberately undersized deck is useful for engine benchmarking.
  if (deck.main.length !== 50) {
    console.warn(`WARNING ${deck.name}: ${deck.main.length} cards, not 50 — not tournament legal`);
  }
  return deck;
}

export function config(a: Deck, b: Deck, seed: number, aSeat: MatchSeat): MatchConfig {
  const seat = (d: Deck, name: string) => ({
    leaderCardId: d.leader,
    mainDeck: [...d.main],
    donDeckCount: 10,
    playerName: name,
  });
  return {
    // Retained for completeness; the engine overwrites it during the 猜拳 setup roll.
    firstPlayer: "north",
    seed,
    shuffleDecks: true,
    openingHandSize: 5,
    skipFirstTurnDraw: true, // Comprehensive Rules 6-3-1
    maxCharacterSlots: 5,
    players:
      aSeat === "south"
        ? { south: seat(a, "A"), north: seat(b, "B") }
        : { south: seat(b, "B"), north: seat(a, "A") },
  };
}

/**
 * Turn order is decided IN GAME and cannot be set from the config (see CLAUDE.md's
 * MatchConfig.firstPlayer note). Seating deck A north puts it on the play; south puts it on the
 * draw, because north always leads. `aSeat` is the whole mechanism.
 */
export function playOne(
  a: Deck,
  b: Deck,
  seed: number,
  aSeat: MatchSeat,
  strategyA: OnePieceBotStrategy,
  strategyB: OnePieceBotStrategy,
  turnBudget: number,
  maxCommands: number,
): GameResult {
  const r = runBotMatch(
    config(a, b, seed, aSeat),
    { [aSeat]: strategyA, [otherSeat(aSeat)]: strategyB } as Record<MatchSeat, OnePieceBotStrategy>,
    { maxCommands },
  );
  const turns = r.finalState.turnNumber ?? 0;
  const actualFirst = (r.finalState.config?.firstPlayer ?? "north") as MatchSeat;

  let outcome: GameResult["outcome"];
  if (turns > turnBudget) {
    outcome = "timeout"; // legacy_turn_budget_proxy — an uncalibrated post-hoc knob, not a real clock
  } else if (r.winner === null) {
    outcome = "unfinished"; // our ceiling, not the game's
  } else {
    outcome = r.winner === aSeat ? "win" : "loss";
  }
  const tail = r.commandHistory.slice(-1)[0] as { type?: string } | undefined;
  const rejection =
    r.termination === "illegal-command"
      ? (r.logHistory
          .filter((l) => /cannot|only|must|invalid|not /i.test(String(l)))
          .slice(-1)[0] ?? "")
      : "";

  return {
    seed,
    aSeat,
    lastCommand: tail?.type ?? "none",
    rejection: String(rejection).slice(0, 160),
    aOnPlay: actualFirst === aSeat,
    outcome,
    turns,
    commands: r.totalCommands,
    termination: String(r.termination),
    stuck: Boolean(r.stuck),
  };
}

/** Wilson score interval — correct near 0 and 1, where the normal approximation is not. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - spread) / d, (centre + spread) / d];
}

export interface Summary {
  games: number;
  wins: number;
  losses: number;
  timeouts: number;
  unfinished: number;
  winRate: number;
  ci: [number, number];
  medianTurns: number;
  meanCommands: number;
}

export function summarize(rs: GameResult[]): Summary {
  const wins = rs.filter((r) => r.outcome === "win").length;
  const losses = rs.filter((r) => r.outcome === "loss").length;
  const timeouts = rs.filter((r) => r.outcome === "timeout").length;
  const unfinished = rs.filter((r) => r.outcome === "unfinished").length;
  const decided = rs.length - unfinished;
  const turns = rs.map((r) => r.turns).sort((x, y) => x - y);
  return {
    games: rs.length,
    wins,
    losses,
    timeouts,
    unfinished,
    winRate: decided ? wins / decided : 0,
    ci: wilson(wins, decided),
    medianTurns: turns.length ? (turns[Math.floor(turns.length / 2)] ?? 0) : 0,
    meanCommands: rs.length ? rs.reduce((s, r) => s + r.commands, 0) / rs.length : 0,
  };
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
const ciStr = (s: Summary) => `[${pct(s.ci[0])}, ${pct(s.ci[1])}]`;

export function report(label: string, all: GameResult[]): Summary {
  const onPlay = all.filter((r) => r.aOnPlay);
  const onDraw = all.filter((r) => !r.aOnPlay);
  const s = summarize(all);
  const p = summarize(onPlay);
  const d = summarize(onDraw);
  console.log(`\n${label}`);
  console.log(`  overall   ${pct(s.winRate)}  ${ciStr(s)}   n=${s.games}`);
  console.log(`  on play   ${pct(p.winRate)}  ${ciStr(p)}   n=${p.games}`);
  console.log(`  on draw   ${pct(d.winRate)}  ${ciStr(d)}   n=${d.games}`);
  console.log(`  play/draw gap ${(100 * (p.winRate - d.winRate)).toFixed(2)} pts`);
  console.log(
    `  timeouts  ${s.timeouts} (${pct(s.timeouts / Math.max(1, s.games))}) — legacy_turn_budget_proxy,` +
      ` double losses   median turns ${s.medianTurns}   mean cmds ${s.meanCommands.toFixed(1)}`,
  );
  if (s.unfinished > 0) {
    console.log(
      `  *** UNFINISHED ${s.unfinished}/${s.games} (${pct(s.unfinished / s.games)}) — command ` +
        `ceiling or engine give-up. NOT counted as losses. Raise --max-commands, or the policy ` +
        `cannot close these games and the win rate above is drawn from a biased subset. ***`,
    );
  }
  const reasons = new Map<string, number>();
  for (const r of all) reasons.set(r.termination, (reasons.get(r.termination) ?? 0) + 1);
  const breakdown = [...reasons.entries()].sort((x, y) => y[1] - x[1]);
  console.log(`  termination: ${breakdown.map(([k, v]) => `${k}=${v}`).join("  ")}`);
  const abandonedGames = all.filter((r) => r.termination !== "rules-win");
  if (abandonedGames.length > all.length * 0.05) {
    console.log(
      `  *** WARNING: ${pct(abandonedGames.length / all.length)} of games were abandoned by the ` +
        `engine, not decided. Win rates above are NOT meaningful — the bot cannot play this deck. ***`,
    );
    const cmds = new Map<string, number>();
    for (const r of abandonedGames) cmds.set(r.lastCommand, (cmds.get(r.lastCommand) ?? 0) + 1);
    console.log(
      `  last accepted command before giving up: ` +
        [...cmds.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 6)
          .map(([k, v]) => `${k}=${v}`)
          .join("  "),
    );
    const rejectionReasons = new Map<string, number>();
    for (const r of abandonedGames)
      if (r.rejection) rejectionReasons.set(r.rejection, (rejectionReasons.get(r.rejection) ?? 0) + 1);
    for (const [reasonText, n] of [...rejectionReasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)) {
      console.log(`    ${String(n).padStart(4)}x  ${reasonText}`);
    }
  }
  return s;
}

/**
 * Paired difference over common random numbers, with a normal interval on the mean of the
 * per-seed differences.
 */
export function pairedDiff(a: GameResult[], b: GameResult[]) {
  const n = Math.min(a.length, b.length);
  const score = (o: GameResult["outcome"]) => (o === "win" ? 1 : 0);
  const diffs: number[] = [];
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    if (a[i]!.outcome === "unfinished" || b[i]!.outcome === "unfinished") {
      skipped++;
      continue;
    }
    diffs.push(score(a[i]!.outcome) - score(b[i]!.outcome));
  }
  if (diffs.length === 0) return { mean: 0, se: 0, lo: 0, hi: 0, n: 0, discordant: 0, skipped };
  const m = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / m;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, m - 1);
  const se = Math.sqrt(variance / m);
  const discordant = diffs.filter((d) => d !== 0).length;
  return { mean, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se, n: m, discordant, skipped };
}

/**
 * The legacy direct-A/B CLI body, moved verbatim (behaviorally) out of sim/matchup.sim.test.ts's
 * test callback. Reads the same SIM_* environment variables, prints the same reports, and writes
 * sim/results/last-run.json with the same field set — plus one additive field (turnBudgetKind)
 * documenting that the turn threshold is a legacy proxy, never a calibrated round timeout.
 *
 * The one BEHAVIOR fix: SIM_FIRST is validated through the shared parseFirstPlayerValue() so an
 * unrecognized value (e.g. "banana") throws invalid_first_player instead of silently falling back
 * to alternating seats.
 */
export function runLegacyMatchupCli(): void {
  const root = env("SIM_ROOT", process.cwd());
  const deckA = loadDeck(resolve(root, env("SIM_DECK_A", "sim/decks/st01.json")));
  const deckB = loadDeck(resolve(root, env("SIM_DECK_B", "sim/decks/st01.json")));
  const comparePath = env("SIM_COMPARE", "");
  const games = Number(env("SIM_GAMES", "200"));
  const seed0 = Number(env("SIM_SEED", "1000"));
  const turnBudget = Number(env("SIM_TURN_BUDGET", "40"));
  const maxCommands = Number(env("SIM_MAX_COMMANDS", "800"));
  const strategyName = env("SIM_STRATEGY", "valueRanked");
  const strategyNameA = env("SIM_STRATEGY_A", strategyName);
  const strategyNameB = env("SIM_STRATEGY_B", strategyName);
  const strategyA = pickStrategy(strategyNameA);
  const strategyB = pickStrategy(strategyNameB);

  console.log(
    `\nSIM  A=${deckA.name} vs B=${deckB.name}  games=${games} ` +
      (strategyNameA === strategyNameB
        ? `strategy=${strategyNameA} `
        : `strategyA=${strategyNameA} strategyB=${strategyNameB} `) +
      `turnBudget=${turnBudget} seed0=${seed0}  catalog=${allCards.length} cards`,
  );

  const missing = [...new Set([deckA.leader, ...deckA.main, deckB.leader, ...deckB.main])].filter(
    (id) => !allCards.some((c) => c.id === id),
  );
  if (missing.length) {
    throw new Error(
      `${missing.length} card id(s) are not in the engine catalog: ${missing.slice(0, 10).join(", ")}` +
        `${missing.length > 10 ? " …" : ""}. OP15/OP16 need ./scripts/bootstrap.sh to graft them first.`,
    );
  }

  // Invalid --first now fails loudly (invalid_first_player) instead of silently becoming
  // "alternate" — the fix this task makes to the legacy adapter.
  const forceFirst = parseFirstPlayerValue(env("SIM_FIRST", "alternate"));
  const seatAt = (i: number): MatchSeat =>
    forceFirst === "play"
      ? "north"
      : forceFirst === "draw"
        ? "south"
        : i % 2 === 0
          ? "north"
          : "south";
  const play = (a: Deck, b: Deck) =>
    Array.from({ length: games }, (_, i) =>
      playOne(a, b, seed0 + i, seatAt(i), strategyA, strategyB, turnBudget, maxCommands),
    );

  const baseline = play(deckA, deckB);
  const base = report(`A "${deckA.name}" vs B "${deckB.name}"`, baseline);

  const out: Record<string, unknown> = {
    deckA: deckA.name,
    deckB: deckB.name,
    games,
    strategyA: strategyNameA,
    strategyB: strategyNameB,
    symmetricStrategy: strategyNameA === strategyNameB,
    turnBudget,
    // Additive label only (Task 10 Step 4): the turn threshold above was never a calibrated round
    // timeout, only a post-hoc proxy knob. Existing keys/values are unchanged.
    turnBudgetKind: "legacy_turn_budget_proxy",
    seed0,
    baseline: base,
    baselineGames: baseline,
  };

  if (comparePath) {
    const deckC = loadDeck(resolve(root, comparePath));
    const variant = play(deckC, deckB);
    const varSum = report(`A' "${deckC.name}" vs B "${deckB.name}"  (common random numbers)`, variant);
    const d = pairedDiff(variant, baseline);
    console.log(`\nPAIRED DIFFERENCE  A' - A`);
    console.log(
      `  ${(100 * d.mean).toFixed(2)} pts   95% CI [${(100 * d.lo).toFixed(2)}, ${(100 * d.hi).toFixed(2)}]`,
    );
    console.log(`  discordant pairs ${d.discordant}/${d.n} — only these carry information`);
    if (d.skipped > 0) {
      console.log(
        `  skipped ${d.skipped} pair(s) where a game never finished — excluded, not scored as losses`,
      );
    }
    if (d.lo > 0) console.log(`  => A' is better, significant at 95%`);
    else if (d.hi < 0) console.log(`  => A' is WORSE, significant at 95%`);
    else console.log(`  => not significant; need more games or the effect is ~0`);
    out.variant = varSum;
    out.variantName = deckC.name;
    out.pairedDiff = d;
  }

  const outPath = resolve(root, env("SIM_OUT", "sim/results/last-run.json"));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\nwrote ${outPath}\n`);
}

// ===========================================================================
// STRICT: EngineDeckInput / BatchSpec / RawGameResult / runBatch — the environment job adapter's
// engine execution. No environment-variable reads, no file writes.
// ===========================================================================

export interface EngineDeckInput {
  readonly displayName?: string | null;
  readonly leaderGameplayId: string;
  readonly mainDeckCounts: Readonly<Record<string, number>>;
  /**
   * Provenance only — runBatch itself never reads these. They exist so a caller (the environment
   * job adapter) can carry a DeckSnapshot's identity through to the raw result envelope without
   * runBatch needing to know anything about hashing.
   */
  readonly artifactHash?: string;
  readonly gameplayHash?: string;
}

export interface BatchSpec {
  candidate: EngineDeckInput;
  opponent: EngineDeckInput;
  fixedSeat: "play" | "draw" | "alternate";
  seeds: readonly number[];
  strategyCandidate: StrategyName;
  strategyOpponent: StrategyName;
  maxCommands: number;
  maxTurns: number;
}

export interface RawGameResult {
  seed: number;
  requestedSeat: "play" | "draw";
  actualSeat: "north" | "south";
  aOnPlay: boolean;
  outcome: "win" | "loss" | "unfinished" | "tool_failure";
  engineTermination: string;
  terminationCause: string;
  turns: number;
  commands: number;
}

/** Deterministic expansion, sorted by gameplay id so identical counts always produce one array. */
export function expandMainDeckCounts(counts: Readonly<Record<string, number>>): string[] {
  const ids: string[] = [];
  for (const id of Object.keys(counts).sort()) {
    const count = counts[id]!;
    for (let i = 0; i < count; i += 1) ids.push(id);
  }
  return ids;
}

function engineSeatFor(deck: EngineDeckInput, playerName: string) {
  return {
    leaderCardId: deck.leaderGameplayId,
    mainDeck: expandMainDeckCounts(deck.mainDeckCounts),
    donDeckCount: 10,
    playerName,
  };
}

/** north for "play", south for "draw"; alternates by SEED-ARRAY INDEX only for "alternate". */
function candidateSeatForIndex(fixedSeat: BatchSpec["fixedSeat"], index: number): MatchSeat {
  if (fixedSeat === "play") return "north";
  if (fixedSeat === "draw") return "south";
  return index % 2 === 0 ? "north" : "south";
}

function requestedSeatLabel(fixedSeat: BatchSpec["fixedSeat"], candidateSeat: MatchSeat): "play" | "draw" {
  if (fixedSeat === "play" || fixedSeat === "draw") return fixedSeat;
  return candidateSeat === "north" ? "play" : "draw";
}

/**
 * I2 fix (fix round 1): genuine readback of which seat the engine's OWN final state says holds
 * "candidate" — takes ONLY the players record, never the seat we requested, so it cannot degrade
 * into an echo of the input. The prior version simply returned the requested `candidateSeat`
 * unconditionally, which made every downstream actualSeat/aOnPlay consistency check a tautology
 * that no runBatch output could ever fail.
 */
export function deriveCandidateSeat(
  players: Partial<Record<MatchSeat, { playerName?: string }>>,
): MatchSeat {
  const found = (["north", "south"] as const).find((seat) => players[seat]?.playerName === "candidate");
  if (found === undefined) {
    const error = new Error(
      `seat_drift: no seat in the engine's final state reports playerName="candidate" (players=${JSON.stringify(players)})`,
    );
    (error as Error & { code?: string }).code = "seat_drift";
    throw error;
  }
  return found;
}

export function runBatch(spec: BatchSpec): RawGameResult[] {
  const strategyCandidate = pickStrategy(spec.strategyCandidate);
  const strategyOpponent = pickStrategy(spec.strategyOpponent);

  return spec.seeds.map((seed, index) => {
    const candidateSeat = candidateSeatForIndex(spec.fixedSeat, index);
    const opponentSeat = otherSeat(candidateSeat);

    const matchConfig = {
      // Retained for completeness; the engine overwrites it during the 猜拳 setup roll (see the
      // legacy config() above and CLAUDE.md — this is the same silently-discarded field).
      firstPlayer: "north",
      seed,
      shuffleDecks: true,
      openingHandSize: 5,
      skipFirstTurnDraw: true,
      maxCharacterSlots: 5,
      players: {
        [candidateSeat]: engineSeatFor(spec.candidate, "candidate"),
        [opponentSeat]: engineSeatFor(spec.opponent, "opponent"),
      },
    } as unknown as MatchConfig;

    const strategies = {
      [candidateSeat]: strategyCandidate,
      [opponentSeat]: strategyOpponent,
    } as Record<MatchSeat, OnePieceBotStrategy>;

    const result = runBotMatch(matchConfig, strategies, { maxCommands: spec.maxCommands });

    const turns = result.finalState.turnNumber ?? 0;

    // I2 fix (fix round 1): actualSeat is DERIVED from the engine's own final config.players, not
    // echoed from the candidateSeat we requested — otherwise the requestedSeatLabel/aOnPlay/winner
    // computations below (and validateRawJobResult's later cross-check) would all be tautological,
    // since they would just be comparing the request against itself.
    const players = (result.finalState.config?.players ?? {}) as Partial<
      Record<MatchSeat, { playerName?: string }>
    >;
    const actualSeat = deriveCandidateSeat(players);

    // Read back rather than assume: who ACTUALLY went first, per the engine's own 猜拳 setup roll.
    // Empirically north always leads (CLAUDE.md: "north led all 120 test games"), but that is a
    // measured fact, not a guaranteed invariant — so this is read from final state every game, and
    // validateRawJobResult (environment-contract.mjs) is what turns a violation into a hard failure.
    const actualFirstSeat = (result.finalState.config?.firstPlayer ?? "north") as MatchSeat;
    const aOnPlay = actualFirstSeat === actualSeat;

    const winnerLabel: "candidate" | "opponent" | null =
      result.winner === null ? null : result.winner === actualSeat ? "candidate" : "opponent";

    const classification = classifyTermination({
      engineTermination: String(result.termination),
      winner: winnerLabel,
      turns,
      maxTurns: spec.maxTurns,
      commands: result.totalCommands,
      maxCommands: spec.maxCommands,
    }) as { outcome: RawGameResult["outcome"]; terminationCause: string };

    return {
      seed,
      requestedSeat: requestedSeatLabel(spec.fixedSeat, actualSeat),
      actualSeat,
      aOnPlay,
      outcome: classification.outcome,
      engineTermination: String(result.termination),
      terminationCause: classification.terminationCause,
      turns,
      commands: result.totalCommands,
    };
  });
}

// ===========================================================================
// STRICT: atomic no-clobber file publication for the raw job-result file.
//
// Reimplemented locally (not imported from environment/store.mjs) so the harness copy set for
// --harness-tests / job mode stays exactly { batch-runner.ts, environment-contract.mjs,
// environment/canonical.mjs, environment/hash.mjs } per the controller ruling — this file already
// needs node:fs for the legacy last-run.json writer, so the marginal cost of the same durability
// primitives (temp file, restrictive mode, fsync, no-clobber link, directory fsync) is a handful of
// lines rather than a new copied dependency.
// ===========================================================================

export class EnvironmentOutputError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EnvironmentOutputError";
    this.code = code;
  }
}

export function publishRawJobResultFile(targetPath: string, payload: unknown): void {
  const directory = dirname(targetPath);
  mkdirSync(directory, { recursive: true, mode: 0o755 });

  // Fast, cheap, non-authoritative pre-check: gives a clear error without allocating a temp file.
  // The authoritative no-clobber guarantee is the exclusive `link` below, which is TOCTOU-safe.
  if (existsSync(targetPath)) {
    throw new EnvironmentOutputError(
      "environment_output_exists",
      `refusing to overwrite existing output at ${targetPath}`,
    );
  }

  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const temp = join(directory, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes.subarray(offset));
      if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) {
        throw new EnvironmentOutputError(
          "environment_output_write_invalid",
          `write made invalid progress (${count}) toward ${targetPath}`,
        );
      }
      offset += count;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    linkSync(temp, targetPath);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Best-effort cleanup only; the failure below is authoritative.
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new EnvironmentOutputError(
        "environment_output_exists",
        `refusing to overwrite existing output at ${targetPath}`,
      );
    }
    throw error;
  }

  try {
    unlinkSync(temp);
  } catch {
    // ENOENT is fine: the no-clobber link already moved ownership to the target.
  }

  const directoryFd = openSync(directory, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
}
