// The offline simulation runner used by every automated Task 11 test and by the Step 7 CLI smoke.
//
// It presents EXACTLY the interface environment/simulation.mjs uses for the real runner
// (`{ name, run({ jobPath, outPath, job }) }`), so the seam is injectable and no automated test ever
// touches the vendored engine. That matters for a concrete measured reason: engine throughput is
// ~2-4 games/s, and one environment plan here is 4 jobs x 200 seeds = 800 games -- minutes of engine
// time per assertion. The real path is already certified by Task 10.
//
// What this runner does NOT do is fake any hash. It re-validates the job it is handed with Task 10's
// own `validateEnvironmentJob` and builds its envelope with Task 10's own `buildRawJobResult`, so
// every jobId/planHash/resultHash in a fixture-driven test is computed by production code at run
// time. Its ONLY input is an outcome script: how many of each cell's games are wins, losses, or
// engine-unfinished. Outcomes are assigned by seed-array index (the first `wins` indexes win, then
// `losses`, then `unfinished`), which keeps every aggregate exactly hand-checkable.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { buildRawJobResult, validateEnvironmentJob } from "../../../sim/environment-contract.mjs";

export const DEFAULT_SCRIPT_URL = new URL("./minimal-valid-results.json", import.meta.url);

export function loadScript(url = DEFAULT_SCRIPT_URL) {
  return JSON.parse(readFileSync(url, "utf8"));
}

/**
 * The cell keys an outcome script may be written against, most specific first:
 *
 *   1. `<opponent gameplayHash>|<seat>` -- required when one archetype has SEVERAL representative
 *      decks, because they share a leader and would otherwise collide on key 2 and be given
 *      identical outcomes, which would make a 0.6/0.4 within-archetype weighting unobservable.
 *   2. `leader:<opponent leaderGameplayId>|<seat>` -- the readable form, one representative per
 *      archetype.
 */
export function scriptCellKeys(job) {
  return [
    `${job.opponent.gameplayHash}|${job.plan.fixedSeat}`,
    `leader:${job.opponent.leaderGameplayId}|${job.plan.fixedSeat}`,
  ];
}

export function scriptCellKey(job) {
  return scriptCellKeys(job)[1];
}

function cellPlan(script, job) {
  const keys = scriptCellKeys(job);
  const key = keys.find((candidate) => script.cells?.[candidate] !== undefined) ?? keys[1];
  const cell = script.cells?.[key] ?? script.default;
  if (cell === undefined) {
    const error = new Error(`fake_runner_script_incomplete: no outcome plan for ${key}`);
    error.code = "fake_runner_script_incomplete";
    throw error;
  }
  const wins = cell.wins ?? 0;
  const losses = cell.losses ?? 0;
  const unfinished = cell.unfinished ?? 0;
  const toolFailures = cell.toolFailures ?? 0;
  const total = wins + losses + unfinished + toolFailures;
  if (total !== job.plan.seeds.length) {
    const error = new Error(
      `fake_runner_script_incomplete: ${key} plans ${total} games for ${job.plan.seeds.length} seeds`,
    );
    error.code = "fake_runner_script_incomplete";
    throw error;
  }
  return { wins, losses, unfinished, toolFailures };
}

function rowFor(job, seed, index, plan) {
  const actualSeat = job.plan.fixedSeat === "play" ? "north" : "south";
  const base = {
    seed,
    requestedSeat: job.plan.fixedSeat,
    actualSeat,
    aOnPlay: job.plan.fixedSeat === "play",
    turns: 9 + (index % 5),
    commands: 90 + (index % 7),
  };
  if (index < plan.wins) {
    return { ...base, outcome: "win", engineTermination: "rules-win", terminationCause: "rules-win" };
  }
  if (index < plan.wins + plan.losses) {
    return { ...base, outcome: "loss", engineTermination: "rules-win", terminationCause: "rules-win" };
  }
  if (index < plan.wins + plan.losses + plan.unfinished) {
    return { ...base, outcome: "unfinished", engineTermination: "max-actions", terminationCause: "max-actions" };
  }
  return {
    ...base,
    outcome: "tool_failure",
    engineTermination: "illegal-command",
    terminationCause: "illegal-command",
  };
}

function writeExclusive(target, content) {
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  // "wx" mirrors the store's own no-clobber discipline: a runner never overwrites an output.
  const fd = openSync(target, "wx", 0o600);
  try {
    const bytes = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes.subarray(offset));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * @param script an outcome script: { default?, cells?: { "<archetypeId>|<seat>": {wins,losses,...} } }
 * @param options.arm when the script is arm-shaped ({ arms: { base, variant } }), which arm to play.
 * @param options.onJob optional observer, so a test can assert what the runner was actually handed.
 */
export function createFakeRunner(script, options = {}) {
  const resolved = script.arms ? script.arms[options.arm] : script;
  if (resolved === undefined) {
    const error = new Error(`fake_runner_arm_unknown: ${String(options.arm)}`);
    error.code = "fake_runner_arm_unknown";
    throw error;
  }
  return {
    name: options.name ?? `fake-simulation-runner${options.arm ? `:${options.arm}` : ""}`,
    run({ jobPath, outPath, job }) {
      // The job the runner scores is the one on DISK at jobPath, not the caller's in-memory object:
      // that is the whole point of materializing a job file, so read it back and re-validate it.
      const onDisk = validateEnvironmentJob(JSON.parse(readFileSync(jobPath, "utf8")));
      if (job !== undefined && onDisk.jobId !== job.jobId) {
        const error = new Error("fake_runner_job_mismatch: the job on disk is not the job requested");
        error.code = "fake_runner_job_mismatch";
        throw error;
      }
      options.onJob?.(onDisk);
      const plan = cellPlan(resolved, onDisk);
      const games = onDisk.plan.seeds.map((seed, index) => rowFor(onDisk, seed, index, plan));
      const raw = buildRawJobResult(onDisk, games);
      writeExclusive(outPath, `${JSON.stringify(raw, null, 2)}\n`);
      return { status: "ok", exitCode: 0 };
    },
  };
}

/**
 * The factory seam the CLI uses. A runner module may export either a ready `default` runner or this
 * `createRunner(context)`; the CLI prefers the factory when it exists, because a variant comparison
 * needs one runner per arm and a scenario file carries its own outcome script. A scenario without a
 * `runnerScript` falls back to the default script, so the simplest plan bundle still runs.
 */
export function createRunner({ scenario, arm } = {}) {
  return createFakeRunner(scenario?.runnerScript ?? loadScript(), { arm });
}

export default createFakeRunner(loadScript());
