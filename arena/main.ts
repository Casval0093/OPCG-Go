// Arena entry point. A plain Node program, NOT a vitest graft.
//
// Verified 2026-08-18: `node arena/main.ts` inside the vendored engine resolves `@tcg/op-cards`
// (2,537 cards) and `../src/core.ts` under Node 22's native type stripping, with no build step. The
// existing note in sim/matchup.sim.test.ts that vitest is "the only reliable way" to reach the card
// registry is therefore not true for a non-test entry point — and it matters, because vitest
// captures stdio and the arena needs a live HTTP server and a human at a keyboard.

import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { allCards } from "@tcg/op-cards";
import { assertPlayable, loadDeck, matchConfig, type Deck } from "./decks.ts";
import { runArenaMatch } from "./driver.ts";
import { firstLegalAgent, scriptedAgent } from "./agents/scripted.ts";
import { humanAgent } from "./agents/human.ts";
import {
  councilAgent,
  ATTRITION_LENS,
  RULES_LENS,
  TEMPO_LENS,
  type CouncilConfig,
  type CouncilMember,
} from "./agents/council.ts";
import { startServer, type ArenaServer } from "./server.ts";
import {
  contested,
  defaultLogPath,
  openDecisionLog,
  readLog,
  renderTranscript,
  sinkFor,
  summarise,
  type DecisionLogWriter,
} from "./log.ts";
import { verifyReplay } from "./replay.ts";
import type { Agent, GameRecord } from "./types.ts";
import { reportBranching } from "./branching.ts";
import { auditor, selfTest, type Violation } from "./integrity.ts";
import { renderPrompt } from "./prompt.ts";
import { deriveFeatures } from "./features.ts";
import type { MatchSeat } from "../src/types.ts";

interface Args {
  root: string;
  south: string;
  north: string;
  deckSouth: string;
  deckNorth: string;
  games: number;
  seed: number;
  out: string;
  quiet: boolean;
  serve: boolean;
  port: number;
  integrity: boolean;
  /** Print exactly what a model would see at the first real decision, then exit. Costs nothing. */
  showPrompt: boolean;
  /** Decision-log path. Empty means "a stamped file under arena/logs/"; `--no-log` disables it. */
  log: string;
  noLog: boolean;
  /** Read a decision log back: summary, then transcript. No engine work, no games played. */
  replay: string;
  /** With `--replay`: print the options NOT taken, and restrict to contested decisions. */
  verbose: boolean;
  contested: boolean;
  /** Re-apply each game's recorded commands and check the outcome reproduces. Roughly 2x runtime. */
  verifyReplay: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    root: process.env.ARENA_ROOT ?? process.cwd(),
    south: "scripted",
    north: "scripted",
    deckSouth: "sim/decks/st01.json",
    deckNorth: "sim/decks/st01.json",
    games: 1,
    seed: 1000,
    out: "arena/results",
    quiet: false,
    serve: false,
    port: 8787,
    integrity: false,
    showPrompt: false,
    log: "",
    noLog: false,
    replay: "",
    verbose: false,
    contested: false,
    verifyReplay: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--south": args.south = value!; i++; break;
      case "--north": args.north = value!; i++; break;
      case "--deck-south": args.deckSouth = value!; i++; break;
      case "--deck-north": args.deckNorth = value!; i++; break;
      case "--games": args.games = Number(value); i++; break;
      case "--seed": args.seed = Number(value); i++; break;
      case "--out": args.out = value!; i++; break;
      case "--quiet": args.quiet = true; break;
      case "--serve": args.serve = true; args.south = "human"; break;
      case "--port": args.port = Number(value); i++; break;
      case "--integrity": args.integrity = true; args.quiet = true; break;
      case "--show-prompt": args.showPrompt = true; args.quiet = true; break;
      case "--log": args.log = value!; i++; break;
      case "--no-log": args.noLog = true; break;
      case "--replay": args.replay = value!; i++; break;
      case "--verbose": args.verbose = true; break;
      case "--contested": args.contested = true; break;
      case "--verify-replay": args.verifyReplay = true; break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }
  return args;
}

/** Named lens presets, so a player config says "tempo" instead of pasting a paragraph. */
const LENSES: Record<string, string> = {
  tempo: TEMPO_LENS,
  attrition: ATTRITION_LENS,
  rules: RULES_LENS,
};

function resolveMember(raw: CouncilMember): CouncilMember {
  return { ...raw, lens: LENSES[raw.lens] ?? raw.lens };
}

/**
 * A player is a config file, not code — the pattern GamingAgent uses and the reason a tournament is
 * just a list of files. Crucially a config names a MODEL, never a credential: the API key comes from
 * the environment and is never written into a player, a game record, or a log line.
 */
function loadCouncil(root: string, path: string): CouncilConfig {
  const raw = JSON.parse(readFileSync(resolve(root, path), "utf8")) as CouncilConfig;
  if (!Array.isArray(raw.proposers) || raw.proposers.length === 0) {
    throw new Error(`${path}: a council needs at least one proposer`);
  }
  if (/sk-ant-|sk-[A-Za-z0-9]{20,}/.test(JSON.stringify(raw))) {
    throw new Error(
      `${path} appears to contain an API key. Player configs must never hold credentials — ` +
        `put the key in .env (gitignored) and remove it from this file.`,
    );
  }
  return {
    ...raw,
    proposers: raw.proposers.map(resolveMember),
    adjudicator: resolveMember(raw.adjudicator ?? { name: "adjudicator", lens: "" }),
    playbook: raw.playbook ?? "",
  };
}

function makeAgent(
  spec: string,
  seat: MatchSeat,
  server: ArenaServer | null,
  root: string,
): Agent {
  switch (spec) {
    case "human": {
      if (!server) throw new Error("--south human / --north human requires --serve");
      return humanAgent(server, "human:ping");
    }
    case "scripted":
    case "improved":
      return scriptedAgent("improved");
    case "faithful":
      return scriptedAgent("faithful");
    case "firstLegal":
      return firstLegalAgent();
    default:
      // Anything else is read as a path to a player config, so adding an entrant needs no code.
      if (spec.endsWith(".json")) return councilAgent(loadCouncil(root, spec));
      throw new Error(
        `unknown agent "${spec}" for ${seat}. Available: human, scripted, faithful, firstLegal, ` +
          `or a path to a player config JSON (see players/).`,
      );
  }
}

/**
 * Read a decision log back. Deliberately the FIRST thing `main` does: reviewing a log must not need
 * decks, an opponent, or a card catalog, because the common case is looking at a game that has
 * already been played — possibly one that was abandoned halfway, which is the case NDJSON exists for.
 */
function replayLog(args: Args): void {
  const path = resolve(args.root, args.replay);
  const { entries, torn, unknown, corrupt } = readLog(path);
  console.log(`${path}\n${summarise(entries)}`);
  if (torn) {
    console.log(
      "  NOTE: the final line is incomplete — this run was killed mid-write. Every earlier " +
        "record is intact; exactly one decision was lost.",
    );
  }
  if (unknown > 0) {
    console.log(`  NOTE: ${unknown} record(s) of an unknown type — written by a newer format version.`);
  }
  if (corrupt > 0) {
    console.log(
      `  WARNING: ${corrupt} non-final line(s) were not valid JSON and were skipped. That means two ` +
        `processes appended to this path, or a write was truncated. Everything else below is intact.`,
    );
  }
  console.log("");
  if (args.contested) {
    const hard = contested(entries);
    console.log(`CONTESTED DECISIONS (${hard.length}) — a written reason or a dissenting proposer\n`);
    console.log(renderTranscript(hard, { verbose: args.verbose }));
  } else {
    console.log(renderTranscript(entries, { verbose: args.verbose }));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.replay) {
    replayLog(args);
    process.exit(0);
  }

  const south: Deck = loadDeck(args.root, args.deckSouth);
  const north: Deck = loadDeck(args.root, args.deckNorth);
  assertPlayable(south, north);

  // The human seat needs somewhere to look at a board. Nothing else does.
  const humanSeat: MatchSeat | null =
    args.south === "human" ? "south" : args.north === "human" ? "north" : null;
  const server =
    args.serve || humanSeat
      ? startServer({
          seat: humanSeat ?? "south",
          port: args.port,
          cacheDir: resolve(args.root, "arena/.cache/images"),
          webDir: resolve(process.cwd(), "arena/web"),
        })
      : null;

  const agents: Record<MatchSeat, Agent> = {
    south: makeAgent(args.south, "south", server, args.root),
    north: makeAgent(args.north, "north", server, args.root),
  };

  if (server) {
    console.log(`\n  board: ${server.url}   (you are ${humanSeat ?? "south"})\n`);
  }

  console.log(
    `ARENA  south=${agents.south.name} (${south.name})  north=${agents.north.name} (${north.name})` +
      `  games=${args.games}  catalog=${allCards.length}`,
  );

  // Inspecting the prompt is a no-network, no-cost operation, and it is the fastest way to catch a
  // bad playbook or a missing card text before spending anything on a tournament.
  if (args.showPrompt) {
    const council = args.north.endsWith(".json") ? loadCouncil(args.root, args.north) : null;
    let shown = false;
    await runArenaMatch(
      matchConfig(south, north, args.seed, { south: "A", north: "B" }),
      { south: scriptedAgent("improved"), north: scriptedAgent("improved") },
      {
        maxCommands: 800,
        onDecision: (decision, view) => {
          if (shown || decision.source !== "command" || decision.choices.length < 4) return;
          shown = true;
          const prompt = renderPrompt({
            view,
            seat: decision.seat,
            decision,
            features: deriveFeatures(view, decision.seat),
            playbook: council?.playbook ?? "(no player config given; pass --north players/x.json)",
            lens: council?.proposers[0]?.lens ?? "You argue for the strongest move.",
            rejection: null,
          });
          console.log("=".repeat(78));
          console.log("SYSTEM (stable — cached across every decision in the game)");
          console.log("=".repeat(78));
          console.log(prompt.stable);
          console.log("\n" + "=".repeat(78));
          console.log("USER (volatile — changes every decision)");
          console.log("=".repeat(78));
          console.log(prompt.volatile);
          console.log("=".repeat(78));
          console.log(
            `stable ~${Math.round(prompt.stable.length / 4)} tokens, ` +
              `volatile ~${Math.round(prompt.volatile.length / 4)} tokens (rough 4-chars/token estimate)`,
          );
        },
      },
    );
    process.exit(0);
  }

  // Opened AFTER `--show-prompt` exits, so inspecting a prompt never leaves an empty log behind.
  const writer: DecisionLogWriter | null = args.noLog
    ? null
    : openDecisionLog(args.log ? resolve(args.root, args.log) : defaultLogPath(args.root), {
        south: `${agents.south.name} (${south.name})`,
        north: `${agents.north.name} (${north.name})`,
        deckSouth: args.deckSouth,
        deckNorth: args.deckNorth,
        games: args.games,
        seed: args.seed,
        catalog: allCards.length,
      });
  if (writer) console.log(`decisions -> ${writer.path}`);

  const audit = args.integrity ? auditor() : null;
  const records: GameRecord[] = [];
  const tally: Record<string, number> = { south: 0, north: 0, none: 0 };
  const terminations: Record<string, number> = {};

  for (let g = 0; g < args.games; g++) {
    const config = matchConfig(south, north, args.seed + g, {
      south: agents.south.name,
      north: agents.north.name,
    });
    writer?.game({ game: g + 1, seats: { south: agents.south.name, north: agents.north.name }, config });
    const record = await runArenaMatch(config, agents, {
      maxCommands: 800,
      onUpdate: (views, progress) => {
        if (!server || !humanSeat) return;
        server.publish({ view: views[humanSeat], progress });
      },
      audit: audit?.audit,
      // Written per decision, not per run: a game abandoned in the browser keeps what it played.
      sink: writer ? sinkFor(writer, g + 1) : undefined,
    });
    writer?.outcome({ game: g + 1, ...record.outcome, decisions: record.decisions.length });
    records.push(record);
    tally[record.outcome.winner ?? "none"]!++;
    terminations[record.outcome.termination] = (terminations[record.outcome.termination] ?? 0) + 1;
    if (!args.quiet) {
      console.log(
        `  game ${g + 1}: winner=${record.outcome.winner ?? "none"} ` +
          `termination=${record.outcome.termination} turns=${record.outcome.turns} ` +
          `commands=${record.outcome.commands} decisions=${record.decisions.length}`,
      );
    }
  }

  console.log(
    `\nsouth ${tally.south}  north ${tally.north}  undecided ${tally.none}` +
      `   terminations: ${Object.entries(terminations).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  );

  reportBranching(records);

  // Does the recorded command list actually reproduce the game it claims to? This is what makes a
  // logged decision verifiable rather than merely written down, and it was asserted in three comments
  // for a function that did not exist. Opt-in, because a replay costs about what the game cost.
  if (args.verifyReplay) {
    let bad = 0;
    for (const [index, record] of records.entries()) {
      const verdict = verifyReplay(record);
      if (verdict.ok) continue;
      bad++;
      console.log(`\nREPLAY MISMATCH game ${index + 1}:`);
      for (const line of verdict.mismatches) console.log(`  ${line}`);
    }
    console.log(
      `\nREPLAY  ${records.length - bad}/${records.length} game(s) reproduced exactly from ` +
        `(config, commands)` + (bad ? " *** MISMATCHES ABOVE ***" : ""),
    );
    if (bad > 0) process.exitCode = 1;
  }

  if (audit) {
    const byCheck = new Map<string, Violation[]>();
    for (const violation of audit.violations) {
      const bucket = byCheck.get(violation.check) ?? [];
      bucket.push(violation);
      byCheck.set(violation.check, bucket);
    }
    console.log(`\nINTEGRITY  ${audit.steps} states audited, both seats each`);
    // Mutation check: swap each seat's projection for its opponent's. The checks MUST fire.
    const mutant = audit.mutationProbe ? selfTest(audit.mutationProbe) : { fired: [], ok: false };
    console.log(
      `  mutation probe: ${mutant.ok ? "checks fired" : "*** CHECKS DID NOT FIRE ***"} ` +
        `(${mutant.fired.join(", ") || "nothing"}) — a clean probe means the PASS below is vacuous`,
    );
    if (!mutant.ok) process.exitCode = 1;
    if (byCheck.size === 0) {
      console.log("  PASS — no hidden information reached either seat's projection.");
    } else {
      // An advisory finding is reported and does not fail the run. Only an exact check can.
      const hard = [...byCheck.entries()].filter(([check]) => !check.includes("advisory"));
      const advisory = [...byCheck.entries()].filter(([check]) => check.includes("advisory"));
      for (const [check, list] of hard.sort()) {
        console.log(`  FAIL ${check}: ${list.length} violation(s)`);
        for (const violation of list.slice(0, 3)) {
          console.log(`    turn ${violation.turn} ${violation.seat}: ${violation.detail}`);
        }
      }
      for (const [check, list] of advisory.sort()) {
        console.log(
          `  advisory ${check}: ${list.length} occurrence(s) — expected on decks with reveal ` +
            `effects and duplicate copies; see the comment in arena/integrity.ts`,
        );
        for (const violation of list.slice(0, 2)) {
          console.log(`    turn ${violation.turn} ${violation.seat}: ${violation.detail}`);
        }
      }
      if (hard.length === 0) {
        console.log("  PASS — no hidden information reached either seat's projection (exact checks).");
      } else {
        process.exitCode = 1;
      }
    }
  }

  const outDir = resolve(args.root, args.out);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "last-run.json");
  writeFileSync(outPath, JSON.stringify({ args, records }, null, 1));
  console.log(`wrote ${outPath}`);
  if (writer) {
    writer.close();
    console.log(`wrote ${writer.path}   (read it with: --replay ${writer.path})`);
  }

  if (server) {
    console.log("board still served; Ctrl-C to stop.");
  } else {
    // `process.exit(0)` was here, and it DISCARDED `process.exitCode`. Both audits in this file set
    // that field to fail a run — the integrity checks and the replay verification — so the hard
    // integrity failure has never actually been able to fail one. Exiting with what was set is the
    // difference between an audit and a decoration. Verified by mutating replay.ts: 1 -> exit 1.
    process.exit(process.exitCode ?? 0);
  }
}

await main();
