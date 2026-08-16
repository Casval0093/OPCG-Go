// Matchup simulator — the measurement layer the tech-slot question needs.
//
//   ./scripts/simulate.sh --a sim/decks/st01.json --b sim/decks/st01.json --games 200
//
// Grafted into packages/engine/tests/cards/ and run by the engine's own runner, gated on
// SIM_RUN=1, following the precedent of the engine's RUN_OP_BOT_BATCHES batch tests. It is a
// runner wearing a test's clothes: the engine's module resolution is the only reliable way to
// reach @tcg/op-cards, and vitest is how this repo already reaches it (see bench/throughput.test.ts).
//
// WHAT IT MEASURES, AND WHY IT IS NOT JUST "WIN RATE"
//
// From 官方公认赛赛事守则 V1.6.0 §II (关于时间截止), the SC tournament rules Ping's event runs under:
//
//   "在各对战中，如果在宣布的结束时间到来时还没有决定胜负，则不进行胜负判定，该对战结果为双方败北。"
//
// If the round clock expires with no winner, the result is **a loss for BOTH players** — 双方败北.
// Not a draw. That makes an unfinished game strictly worse than a coin flip, and it means a win
// rate computed over decided games only would systematically flatter slow decks. So every game
// resolves to one of three outcomes, and `timeout` counts against BOTH decks:
//
//   win | loss | timeout  (double loss)
//
// Extra turns exist ONLY in finals and elimination brackets, not in Swiss rounds: +3 turns if time
// is called on the first player's turn, +2 if on the second player's, then a tiebreak of Life count
// -> deck count -> rock-paper-scissors. Ping's event is Swiss + top cut, so both regimes apply and
// they score differently. `--turn-budget` models the Swiss regime, which is the one that decides
// whether you reach the cut at all.
//
// TURN BUDGET IS A PROXY, AND AN UNCALIBRATED ONE
//
// The engine has no wall clock, so real minutes are not simulable. `--turn-budget` caps total turns
// and calls anything beyond it a timeout. The mapping from turns to 30 minutes is NOT yet measured
// against real games — until it is, treat the timeout column as a sensitivity knob, not a
// prediction. The honest default is a budget high enough that timeouts are rare, plus the reported
// turn distribution so a threshold can be applied afterwards without re-running.
//
// PLAY/DRAW IS SEPARATED, NEVER AVERAGED
//
// Turn order in OPTCG is severely asymmetric — per the Comprehensive Rules 6-3-1, the first player
// skips their first draw. Games alternate who leads strictly by index, so the split is exactly
// balanced by construction and each side is reported with its own interval.
//
// COMMON RANDOM NUMBERS
//
// A tech-slot test compares two decks differing by 1-2 cards, so the effect is small and the noise
// is not. Both arms are run over the SAME seed sequence, which pairs the games: identical shuffles
// and identical opponent draws, differing only by the swapped cards. The paired difference has far
// lower variance than two independent samples, which is what makes a 2-3 point effect measurable
// in a feasible number of games. See --compare.

import { test } from "vite-plus/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
// The engine resolves card ids through a runtime registry that is populated as a SIDE EFFECT of
// importing @tcg/op-cards (its index calls registerCards(allCards) at module scope). Decks here
// are plain id strings, so without this import every lookup throws "Unknown One Piece card".
// Imported for the value, not just the side effect, so it cannot be dropped as unused.
import { allCards } from "@tcg/op-cards";
import { runBotMatch } from "../../src/automation/bot-harness.ts";
import {
  greedyStrategy,
  valueRankedStrategy,
  randomStrategy,
} from "../../src/automation/bot-strategies.ts";
import type { MatchConfig, MatchSeat } from "../../src/types.ts";
import type { OnePieceBotStrategy } from "../../src/automation/bot-strategies.ts";

const STRATEGIES: Record<string, OnePieceBotStrategy> = {
  valueRanked: valueRankedStrategy,
  greedy: greedyStrategy,
  random: randomStrategy,
};

interface Deck {
  name: string;
  leader: string;
  /** 50 card ids, repeats included. */
  main: string[];
}

interface GameResult {
  seed: number;
  /** Which seat deck A occupied. Alternated by index, which is what controls turn order. */
  aSeat: MatchSeat;
  /** Whether deck A was the first player in this game. */
  aOnPlay: boolean;
  /** Outcome for deck A. */
  outcome: "win" | "loss" | "timeout";
  turns: number;
  commands: number;
  /**
   * Why the game stopped, straight from the engine. Critical: a game the ENGINE abandoned
   * (unsupported prompt, repeated state, command budget) is not a game that ran out of CLOCK.
   * Conflating them reports engine limitations as deck weakness.
   */
  termination: string;
  stuck: boolean;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function loadDeck(path: string): Deck {
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

function config(a: Deck, b: Deck, seed: number, aSeat: MatchSeat): MatchConfig {
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
 * Turn order is decided IN GAME and cannot be set from the config. Measured, not assumed:
 *
 *   - `MatchConfig.firstPlayer` is only the initial `activeSeat`. The engine models the 猜拳 roll
 *     of Comprehensive Rules 5-2-1, and the winner's `chooseFirstPlayer` command overwrites
 *     `config.firstPlayer` during setup.
 *   - Forcing the config both ways produced byte-identical results — same win rate, same median
 *     turns, same mean commands. The setting is silently discarded.
 *   - That command is consumed by `runBotMatch`'s prompt queue before any strategy sees it, so a
 *     strategy wrapper cannot intercept it either.
 *   - Over 120 games, **north led every single one**. Turn order is deterministic here.
 *
 * So turn order is controlled by SEAT ASSIGNMENT instead: since north always leads, seating deck A
 * north puts it on the play and seating it south puts it on the draw. Seats are labels, and the
 * mirror test verifies they carry no bias of their own — identical decks in both arrangements must
 * give complementary win rates. `aSeat` is the whole mechanism.
 */
function playOne(
  a: Deck,
  b: Deck,
  seed: number,
  aSeat: MatchSeat,
  strategy: OnePieceBotStrategy,
  turnBudget: number,
  maxCommands: number,
): GameResult {
  const r = runBotMatch(config(a, b, seed, aSeat), { south: strategy, north: strategy }, { maxCommands });
  const turns = r.finalState.turnNumber ?? 0;

  // Read who actually led rather than trusting the request; if the engine's behaviour changes,
  // the play/draw buckets follow it instead of silently mislabelling every game.
  const actualFirst = (r.finalState.config?.firstPlayer ?? "north") as MatchSeat;

  // Timeout dominates: an unfinished game is 双方败北 regardless of who was ahead.
  // `stuck` and command exhaustion are engine limits rather than game states, but they are
  // indistinguishable from "did not finish in time" at the table, so they score the same.
  let outcome: GameResult["outcome"];
  if (r.winner === null || turns > turnBudget) {
    outcome = "timeout";
  } else {
    outcome = r.winner === aSeat ? "win" : "loss";
  }
  return {
    seed,
    aSeat,
    aOnPlay: actualFirst === aSeat,
    outcome,
    turns,
    commands: r.totalCommands,
    termination: String(r.termination),
    stuck: Boolean(r.stuck),
  };
}

/** Wilson score interval — correct near 0 and 1, where the normal approximation is not. */
function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - spread) / d, (centre + spread) / d];
}

interface Summary {
  games: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** Timeouts count as losses — the tournament rule, not a modelling choice. */
  winRate: number;
  ci: [number, number];
  medianTurns: number;
  meanCommands: number;
}

function summarize(rs: GameResult[]): Summary {
  const wins = rs.filter((r) => r.outcome === "win").length;
  const losses = rs.filter((r) => r.outcome === "loss").length;
  const timeouts = rs.filter((r) => r.outcome === "timeout").length;
  const turns = rs.map((r) => r.turns).sort((x, y) => x - y);
  return {
    games: rs.length,
    wins,
    losses,
    timeouts,
    winRate: rs.length ? wins / rs.length : 0,
    ci: wilson(wins, rs.length),
    medianTurns: turns.length ? (turns[Math.floor(turns.length / 2)] ?? 0) : 0,
    meanCommands: rs.length ? rs.reduce((s, r) => s + r.commands, 0) / rs.length : 0,
  };
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
const ciStr = (s: Summary) => `[${pct(s.ci[0])}, ${pct(s.ci[1])}]`;

function report(label: string, all: GameResult[]): Summary {
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
    `  timeouts  ${s.timeouts} (${pct(s.timeouts / Math.max(1, s.games))}) — double losses` +
      `   median turns ${s.medianTurns}   mean cmds ${s.meanCommands.toFixed(1)}`,
  );
  const reasons = new Map<string, number>();
  for (const r of all) reasons.set(r.termination, (reasons.get(r.termination) ?? 0) + 1);
  const breakdown = [...reasons.entries()].sort((x, y) => y[1] - x[1]);
  console.log(`  termination: ${breakdown.map(([k, v]) => `${k}=${v}`).join("  ")}`);
  // rules-win is a real game ending. Anything else means the ENGINE stopped, not the clock,
  // and those games say nothing about which deck is better.
  const abandoned = all.filter((r) => r.termination !== "rules-win").length;
  if (abandoned > all.length * 0.05) {
    console.log(
      `  *** WARNING: ${pct(abandoned / all.length)} of games were abandoned by the engine, not ` +
        `decided. Win rates below are NOT meaningful — the bot cannot play this deck. ***`,
    );
  }
  return s;
}

/**
 * Paired difference over common random numbers, with a normal interval on the mean of the
 * per-seed differences. Unlike two independent Wilson intervals this keeps the pairing, which
 * is the entire point of running both arms on the same seeds.
 */
function pairedDiff(a: GameResult[], b: GameResult[]) {
  const n = Math.min(a.length, b.length);
  const score = (o: GameResult["outcome"]) => (o === "win" ? 1 : 0);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push(score(a[i]!.outcome) - score(b[i]!.outcome));
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(variance / n);
  const discordant = diffs.filter((d) => d !== 0).length;
  return { mean, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se, n, discordant };
}

const run = process.env.SIM_RUN === "1" ? test : test.skip;

run("matchup", () => {
  const root = env("SIM_ROOT", process.cwd());
  const deckA = loadDeck(resolve(root, env("SIM_DECK_A", "sim/decks/st01.json")));
  const deckB = loadDeck(resolve(root, env("SIM_DECK_B", "sim/decks/st01.json")));
  const comparePath = env("SIM_COMPARE", "");
  const games = Number(env("SIM_GAMES", "200"));
  const seed0 = Number(env("SIM_SEED", "1000"));
  const turnBudget = Number(env("SIM_TURN_BUDGET", "40"));
  const maxCommands = Number(env("SIM_MAX_COMMANDS", "800"));
  const strategyName = env("SIM_STRATEGY", "valueRanked");
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error(`unknown strategy ${strategyName}; have ${Object.keys(STRATEGIES).join(", ")}`);

  console.log(
    `\nSIM  A=${deckA.name} vs B=${deckB.name}  games=${games} strategy=${strategyName} ` +
      `turnBudget=${turnBudget} seed0=${seed0}  catalog=${allCards.length} cards`,
  );

  // Fail loudly and specifically rather than letting the engine throw a bare
  // "Unknown One Piece card" from deep inside match construction.
  const missing = [...new Set([deckA.leader, ...deckA.main, deckB.leader, ...deckB.main])].filter(
    (id) => !allCards.some((c) => c.id === id),
  );
  if (missing.length) {
    throw new Error(
      `${missing.length} card id(s) are not in the engine catalog: ${missing.slice(0, 10).join(", ")}` +
        `${missing.length > 10 ? " …" : ""}. OP15/OP16 need ./scripts/bootstrap.sh to graft them first.`,
    );
  }

  // Alternate strictly by index so play/draw is exactly balanced rather than balanced in expectation.
  // SIM_FIRST pins it instead, which is how a seat bias gets separated from a turn-order effect:
  // under a symmetric engine, forcing south-first and forcing north-first must give win rates that
  // sum to ~100%. If they do not, the asymmetry is in the seat, not the turn order.
  // North leads, so seating deck A north puts it on the play. SIM_FIRST pins the seat instead of
  // alternating, which is how a seat bias is separated from a turn-order effect.
  const forceFirst = env("SIM_FIRST", "alternate");
  const seatAt = (i: number): MatchSeat =>
    forceFirst === "play" ? "north" : forceFirst === "draw" ? "south" : i % 2 === 0 ? "north" : "south";
  const play = (a: Deck, b: Deck) =>
    Array.from({ length: games }, (_, i) =>
      playOne(a, b, seed0 + i, seatAt(i), strategy, turnBudget, maxCommands),
    );

  const baseline = play(deckA, deckB);
  const base = report(`A "${deckA.name}" vs B "${deckB.name}"`, baseline);

  const out: Record<string, unknown> = {
    deckA: deckA.name,
    deckB: deckB.name,
    games,
    strategy: strategyName,
    turnBudget,
    seed0,
    baseline: base,
    baselineGames: baseline,
  };

  if (comparePath) {
    // Same seeds, so every game is paired against its baseline twin: identical shuffles and
    // identical opponent draws, differing only by the swapped cards.
    const deckC = loadDeck(resolve(root, comparePath));
    const variant = play(deckC, deckB);
    const varSum = report(`A' "${deckC.name}" vs B "${deckB.name}"  (common random numbers)`, variant);
    const d = pairedDiff(variant, baseline);
    console.log(`\nPAIRED DIFFERENCE  A' - A`);
    console.log(`  ${(100 * d.mean).toFixed(2)} pts   95% CI [${(100 * d.lo).toFixed(2)}, ${(100 * d.hi).toFixed(2)}]`);
    console.log(`  discordant pairs ${d.discordant}/${d.n} — only these carry information`);
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
}, 3_600_000);
