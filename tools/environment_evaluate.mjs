#!/usr/bin/env node
// Evaluate a resolved environment, or compare two of them, and print exactly one JSON result.
//
//   environment_evaluate.mjs evaluate --plan PATH[#KEY] --runner PATH --results-root PATH
//                                     [--cache-root PATH] [--now RFC3339]
//   environment_evaluate.mjs compare  --mode variants     --plan PATH  ...
//   environment_evaluate.mjs compare  --mode environments --plan PATH --plan PATH  ...
//
// Two boundary rules this command exists to hold:
//
//   * The plan selector is ALWAYS explicit. There is no default environment, no default edition and
//     no default alias anywhere in this file -- a caller that forgets `--plan` gets a refusal, never
//     somebody's idea of the obvious environment. `tools/environment_evaluate.test.mjs` greps this
//     source to keep it that way.
//   * This is a COMMAND boundary, so it is the one place allowed to read the host clock (for the
//     display-only `generatedAt`). Everything underneath takes an injected instant and fails closed
//     without one.
//
// Output is one sanitized JSON object on stdout and an exit status of 0 or 1. Absolute filesystem
// paths are repository-private and are redacted from every failure payload.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EnvironmentError } from "../environment/errors.mjs";
import { executeSimulationPlan, expandSimulationPlan } from "../environment/simulation.mjs";
import { aggregateEnvironment, compareEnvironments, compareVariants } from "../environment/report.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Declared the way the three module code sets are, so Task 12 can reconcile the whole surface in one
// place (fix round 1, minor). These are the codes this command boundary raises ITSELF; everything
// else it can print comes from the environment modules and is declared there.
export const CLI_ERROR_CODES = Object.freeze([
  "argument_combination_invalid",
  "environment_plan_unreadable",
  "environment_plan_invalid",
  "environment_evaluate_failed",
]);
const PLAN_BUNDLE_KIND = "environment-evaluation-plan";
const COMMANDS = new Set(["evaluate", "compare"]);
const MODES = new Set(["variants", "environments"]);
const VALUE_FLAGS = new Set(["--runner", "--results-root", "--cache-root", "--now", "--mode"]);
const REPEATABLE_FLAGS = new Set(["--plan"]);
const MAX_DETAIL_STRING = 200;
const MAX_DETAIL_ITEMS = 32;
const MAX_DETAIL_DEPTH = 4;

function fail(code, message, details = {}) {
  throw new EnvironmentError(code, `${code}: ${message}`, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * argument parsing
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const command = argv[0];
  if (!COMMANDS.has(command)) {
    fail("argument_combination_invalid", "the first argument must name a supported command", {
      command: typeof command === "string" ? command : null,
      supported: [...COMMANDS],
    });
  }
  const options = { plan: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (REPEATABLE_FLAGS.has(flag)) {
      if (argv[index + 1] === undefined) fail("argument_combination_invalid", `${flag} needs a value`, { flag });
      options.plan.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      fail("argument_combination_invalid", "unrecognized option", { flag: String(flag) });
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (options[key] !== undefined) {
      // A repeated scalar flag is ambiguous: taking the first or the last silently discards the
      // caller's other intention, so it is refused instead.
      fail("argument_combination_invalid", "an option was given more than once", { flag });
    }
    if (argv[index + 1] === undefined) fail("argument_combination_invalid", `${flag} needs a value`, { flag });
    options[key] = argv[index + 1];
    index += 1;
  }

  const missing = [];
  if (options.plan.length === 0) missing.push("plan");
  if (options.runner === undefined) missing.push("runner");
  if (options.resultsRoot === undefined) missing.push("results-root");
  if (command === "compare" && options.mode === undefined) missing.push("mode");
  if (missing.length > 0) {
    fail("argument_combination_invalid", "a required option is missing", { missing });
  }
  if (options.mode !== undefined && !MODES.has(options.mode)) {
    fail("argument_combination_invalid", "unsupported comparison mode", {
      mode: options.mode,
      supported: [...MODES],
    });
  }
  if (command === "evaluate" && options.mode !== undefined) {
    fail("argument_combination_invalid", "evaluate takes no comparison mode", { flag: "--mode" });
  }
  // Exactly one plan for a single evaluation, and exactly one SCENARIO (carrying both arms) for a
  // variant comparison. A cross-environment comparison deliberately has NO upper bound here: how
  // many environments make a comparison is compareEnvironments' rule, and it reports a one-sided
  // comparison under its own code rather than as an argument error.
  const expectedPlans = command === "evaluate" || options.mode === "variants" ? 1 : null;
  if (expectedPlans !== null && options.plan.length !== expectedPlans) {
    fail("argument_combination_invalid", "the wrong number of plans was given for this command", {
      given: options.plan.length,
      expected: expectedPlans,
    });
  }
  return { command, options };
}

/* ------------------------------------------------------------------ *
 * plan bundles
 * ------------------------------------------------------------------ */

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // The offending selector is named so a human can fix the command -- and it goes through
    // sanitize() on the way out, because an absolute path is repository-private and never part of a
    // machine-readable failure contract.
    fail("environment_plan_unreadable", "the plan file could not be read as JSON", {
      cause: error?.code ?? "invalid",
      selector: path,
    });
  }
  return null;
}

/** `PATH` or `PATH#KEY`, where KEY names a plan bundle held inside a larger scenario document. */
function loadPlanSelector(selector) {
  const hash = selector.lastIndexOf("#");
  const path = hash === -1 ? selector : selector.slice(0, hash);
  const key = hash === -1 ? null : selector.slice(hash + 1);
  const document = readJson(resolve(path));
  const bundle = key === null ? document : document?.[key];
  if (!isRecord(bundle) || bundle.kind !== PLAN_BUNDLE_KIND) {
    fail("environment_plan_invalid", "the selector does not name a resolved evaluation plan bundle", {
      key,
      kind: isRecord(bundle) ? bundle.kind ?? null : null,
    });
  }
  for (const field of ["resolved", "deckSnapshots", "settings"]) {
    if (bundle[field] === undefined) {
      fail("environment_plan_invalid", "a plan bundle needs its resolved environment, decks and settings", {
        field,
      });
    }
  }
  return { document, bundle };
}

function candidateDeckOf(bundle) {
  const deck = bundle.deckSnapshots.find((entry) => entry?.snapshotId === bundle.resolved.candidateDeckRef?.snapshotId);
  if (deck === undefined) {
    fail("environment_plan_invalid", "the plan bundle does not carry its own candidate deck snapshot", {});
  }
  return deck;
}

function expand(bundle) {
  return expandSimulationPlan(bundle.resolved, candidateDeckOf(bundle), {
    ...bundle.settings,
    opponentDecks: bundle.deckSnapshots,
  });
}

/* ------------------------------------------------------------------ *
 * the runner seam
 * ------------------------------------------------------------------ */

async function loadRunnerModule(runnerPath) {
  try {
    return await import(pathToFileURL(resolve(runnerPath)).href);
  } catch (error) {
    fail("simulation_not_ready", "the runner module could not be loaded", {
      cause: error?.code ?? "unloadable",
    });
  }
  return null;
}

function runnerFrom(module, { scenario, arm }) {
  const runner = typeof module.createRunner === "function"
    ? module.createRunner({ scenario, arm })
    : module.default;
  if (!isRecord(runner) || typeof runner.run !== "function") {
    fail("simulation_not_ready", "a runner module must export a runner with a run(request) function", {});
  }
  return runner;
}

/* ------------------------------------------------------------------ *
 * execution
 * ------------------------------------------------------------------ */

function execute(plan, { runner, cacheRoot, resultsRoot, now }) {
  return executeSimulationPlan(plan, {
    runner,
    cacheRoot: resolve(cacheRoot),
    resultsRoot: resolve(resultsRoot),
    now,
  });
}

async function runEvaluate(options, context) {
  const { document, bundle } = loadPlanSelector(options.plan[0]);
  const module = await loadRunnerModule(options.runner);
  const outcome = execute(expand(bundle), {
    ...context,
    runner: runnerFrom(module, { scenario: document, arm: undefined }),
  });
  return {
    status: "ok",
    command: "evaluate",
    report: aggregateEnvironment({ ...outcome, now: context.now }),
  };
}

async function runCompareVariants(options, context) {
  const { document } = loadPlanSelector(`${options.plan[0]}#base`);
  const baseBundle = document.base;
  const variantBundle = document.variant;
  if (!isRecord(variantBundle) || variantBundle.kind !== PLAN_BUNDLE_KIND) {
    fail("environment_plan_invalid", "a variant comparison needs a scenario with a base and a variant arm", {});
  }
  const module = await loadRunnerModule(options.runner);
  const baseline = execute(expand(baseBundle), {
    ...context,
    runner: runnerFrom(module, { scenario: document, arm: "base" }),
  });
  const variant = execute(expand(variantBundle), {
    ...context,
    runner: runnerFrom(module, { scenario: document, arm: "variant" }),
  });
  return {
    status: "ok",
    command: "compare",
    mode: "variants",
    comparison: compareVariants(baseline, variant, { now: context.now }),
  };
}

async function runCompareEnvironments(options, context) {
  const module = await loadRunnerModule(options.runner);
  const entries = [];
  for (const selector of options.plan) {
    const { document, bundle } = loadPlanSelector(selector);
    const plan = expand(bundle);
    const outcome = execute(plan, {
      ...context,
      runner: runnerFrom(module, { scenario: document, arm: undefined }),
    });
    // The label is the Manifest's own immutable identifier: two environments are two populations,
    // so each side is named by the exact revision it came from rather than by a friendly alias that
    // could be shared.
    entries.push({
      label: plan.manifestRef.manifestId,
      report: aggregateEnvironment({ ...outcome, now: context.now }),
    });
  }
  return {
    status: "ok",
    command: "compare",
    mode: "environments",
    comparison: compareEnvironments(entries, { now: context.now }),
  };
}

/* ------------------------------------------------------------------ *
 * output
 * ------------------------------------------------------------------ */

function looksLikeFilesystemPath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

function sanitize(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") {
    if (looksLikeFilesystemPath(value)) return "[redacted-path]";
    return value.length > MAX_DETAIL_STRING ? `${value.slice(0, MAX_DETAIL_STRING)}...` : value;
  }
  if (depth >= MAX_DETAIL_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_DETAIL_ITEMS).map((item) => sanitize(item, depth + 1));
  if (isRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_ITEMS)) {
      result[key] = sanitize(item, depth + 1);
    }
    return result;
  }
  return undefined;
}

function errorPayload(error) {
  return {
    status: "error",
    code: typeof error?.code === "string" && error.code.length > 0 ? error.code : "environment_evaluate_failed",
    details: sanitize(isRecord(error?.details) ? error.details : {}) ?? {},
  };
}

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options.now !== undefined && !RFC3339_PATTERN.test(options.now)) {
    fail("argument_combination_invalid", "--now must be an RFC 3339 instant", {});
  }
  const context = {
    // Host time is read HERE and nowhere deeper: the library refuses to read a clock at all.
    now: options.now ?? new Date().toISOString(),
    cacheRoot: options.cacheRoot ?? join(REPO_ROOT, ".cache", "environment-jobs"),
    resultsRoot: options.resultsRoot,
  };
  if (command === "evaluate") return runEvaluate(options, context);
  if (options.mode === "variants") return runCompareVariants(options, context);
  return runCompareEnvironments(options, context);
}

// Run only when invoked as the entry point, so a test (or Task 12) can import CLI_ERROR_CODES
// without this file executing a command against the importer's own argv.
const invokedDirectly = typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (payload) => {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 0;
    },
    (error) => {
      process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
      process.exitCode = 1;
    },
  );
}

export { main, errorPayload, sanitize };
