// Task 10: the strict fixed-seat environment job adapter.
//
// Vendor-relative imports, same convention as sim/matchup.sim.test.ts / sim/batch-runner.ts: this
// file is copied into the vendored engine's tests/cards/ directory and run there, never from sim/
// directly. scripts/simulate.sh's --job mode invokes exactly this file as the vitest target,
// having cleared every ambient legacy SIM_* variable and set only SIM_ENV_JOB (the job file path)
// and SIM_OUT (the output file path).
//
// This adapter refuses alternate seats (validateEnvironmentJob rejects them), reads only its
// whitelisted job inputs, and emits per-game raw data ONLY — no console report, no comparison, no
// sim/results/last-run.json. It fails closed via validateRawJobResult BEFORE writing anything: a
// provenance mismatch, a seat/aOnPlay drift, or any round_timeout throws simulation_result_mismatch
// and the output file is never created or overwritten.
import { test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildRawJobResult, validateEnvironmentJob, validateRawJobResult } from "./environment-contract.mjs";
import { env, publishRawJobResultFile, runBatch } from "./batch-runner.ts";
import type { BatchSpec, EngineDeckInput } from "./batch-runner.ts";

function toEngineDeckInput(input: Record<string, unknown>): EngineDeckInput {
  return {
    displayName: (input.displayName as string | null | undefined) ?? null,
    leaderGameplayId: input.leaderGameplayId as string,
    mainDeckCounts: input.mainDeckCounts as Record<string, number>,
    artifactHash: input.artifactHash as string,
    gameplayHash: input.gameplayHash as string,
  };
}

function jobToBatchSpec(job: {
  plan: Record<string, unknown>;
  candidate: Record<string, unknown>;
  opponent: Record<string, unknown>;
}): BatchSpec {
  return {
    candidate: toEngineDeckInput(job.candidate),
    opponent: toEngineDeckInput(job.opponent),
    fixedSeat: job.plan.fixedSeat as BatchSpec["fixedSeat"],
    seeds: job.plan.seeds as readonly number[],
    strategyCandidate: job.plan.strategyCandidate as BatchSpec["strategyCandidate"],
    strategyOpponent: job.plan.strategyOpponent as BatchSpec["strategyOpponent"],
    maxCommands: job.plan.maxCommands as number,
    maxTurns: job.plan.maxTurns as number,
  };
}

// Gated on SIM_ENV_JOB being set, mirroring the legacy adapter's SIM_RUN gate — defensive, since in
// normal operation this file is only ever invoked as vitest's sole explicit target.
const run = process.env.SIM_ENV_JOB ? test : test.skip;

run(
  "environment job",
  () => {
    const root = env("SIM_ROOT", process.cwd());
    const jobPathRaw = env("SIM_ENV_JOB", "");
    const outPathRaw = env("SIM_OUT", "");
    if (!jobPathRaw) throw new Error("environment_job_path_missing: SIM_ENV_JOB is not set");
    if (!outPathRaw) throw new Error("environment_output_path_missing: SIM_OUT is not set");

    const resolvedOut = resolve(root, outPathRaw);
    const legacyOutPath = resolve(root, "sim/results/last-run.json");
    if (resolvedOut === legacyOutPath) {
      throw new Error(
        "environment_output_forbidden_path: refusing to target the legacy sim/results/last-run.json path",
      );
    }

    const rawJob = JSON.parse(readFileSync(resolve(root, jobPathRaw), "utf8"));
    const job = validateEnvironmentJob(rawJob);

    console.log(
      `\nENV JOB  jobId=${job.jobId}  planHash=${job.plan.planHash}  fixedSeat=${job.plan.fixedSeat}  ` +
        `seeds=[${job.plan.seeds.join(",")}]`,
    );
    console.log(
      `  strategyCandidate=${job.plan.strategyCandidate}  strategyOpponent=${job.plan.strategyOpponent}  ` +
        `engineRevision=${job.plan.engineRevision}  maxCommands=${job.plan.maxCommands}  ` +
        `maxTurns=${job.plan.maxTurns}  completedGameTarget=${job.plan.completedGameTarget}`,
    );
    console.log(
      `  candidate artifactHash=${job.candidate.artifactHash}  gameplayHash=${job.candidate.gameplayHash}`,
    );
    console.log(
      `  opponent  artifactHash=${job.opponent.artifactHash}  gameplayHash=${job.opponent.gameplayHash}`,
    );

    const games = runBatch(jobToBatchSpec(job));
    const rawResult = buildRawJobResult(job, games);

    // Fails closed BEFORE any write: an aOnPlay/seat/seed/settings mismatch, an unmet
    // completed-game floor, or any round_timeout throws simulation_result_mismatch here rather
    // than being silently published.
    validateRawJobResult(job, rawResult);

    for (const g of games) {
      console.log(
        `  seed=${g.seed}  requestedSeat=${g.requestedSeat}  actualSeat=${g.actualSeat}  ` +
          `aOnPlay=${g.aOnPlay}  outcome=${g.outcome}  engineTermination=${g.engineTermination}  ` +
          `terminationCause=${g.terminationCause}  turns=${g.turns}  commands=${g.commands}`,
      );
    }

    publishRawJobResultFile(resolvedOut, rawResult);
    console.log(`\nwrote ${resolvedOut}  resultHash=${rawResult.resultHash}\n`);
  },
  3_600_000,
);
