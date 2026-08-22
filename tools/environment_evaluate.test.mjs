import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("./environment_evaluate.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../tests/fixtures/environment/", import.meta.url));
const RUNNER = join(FIXTURES, "fake-simulation-runner.mjs");
const PLAN = join(FIXTURES, "minimal-resolved-plan.json");
const OFFICIAL_SCENARIO = join(FIXTURES, "accepted-clock-timeout-results.json");
const PAIRED = join(FIXTURES, "base-variant-paired-results.json");
const INCOMPLETE = join(FIXTURES, "incomplete-field-plan.json");
const NOW = "2026-08-21T10:00:00+08:00";

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "environment-evaluate-test-"));
  try {
    return run({
      root,
      cacheRoot: join(root, "cache"),
      resultsRoot: join(root, "results"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  return result;
}

/**
 * Exactly one JSON document on stdout, or the test fails. JSON.parse itself is the guarantee: it
 * throws on any trailing content, so a second document (or a stray log line) cannot slip through.
 */
function parseOnlyJson(stdout) {
  const trimmed = stdout.trim();
  assert.ok(trimmed.length > 0, "the CLI printed nothing");
  assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), "stdout is not a single JSON object");
  return JSON.parse(trimmed);
}

function run(args, roots) {
  return cli([
    ...args,
    "--runner", RUNNER,
    "--results-root", roots.resultsRoot,
    "--cache-root", roots.cacheRoot,
    "--now", NOW,
  ]);
}

/* ------------------------------------------------------------------ *
 * evaluate
 * ------------------------------------------------------------------ */

test("evaluate prints exactly one report, exits 0, and pins every hash it claims", () => {
  withRoot((roots) => {
    const result = run(["evaluate", "--plan", PLAN], roots);
    assert.equal(result.status, 0, result.stderr);
    const report = parseOnlyJson(result.stdout);

    assert.equal(report.status, "ok");
    assert.equal(report.command, "evaluate");
    const body = report.report;
    assert.equal(body.kind, "environment-evaluation-report");
    assert.equal(body.requestedEnvironment, "SC/latest");
    assert.match(body.environmentKey, /^SC:CN:zh-Hans:Asia\/Shanghai:standard-block2-op16:2026-08-20$/);
    assert.match(body.manifestRef.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(body.candidate.deckRef.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(body.candidate.gameplayHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(body.planHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(body.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(body.references.rules.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(body.settings.engineRevision, "engine-commit-fixture");
    assert.equal(body.confidence.seed, 20260820);
    assert.equal(body.confidence.replicates, 10000);

    // Separate play and draw results, primary; overall only from the Manifest's own weights.
    assert.ok(body.ev.play > 0 && body.ev.play < 1);
    assert.ok(body.ev.draw > 0 && body.ev.draw < 1);
    assert.notEqual(body.ev.play, body.ev.draw);
    assert.deepEqual(body.ev.turnOrderWeights, { play: 0.5, draw: 0.5 });

    // The fixture has no accepted clock, so the report is a labelled diagnostic estimate.
    assert.equal(body.evaluationMode, "diagnostic_estimate");
    assert.equal(body.officialStrengthClaim, false);
    assert.equal(body.strengthClaimWithheld, true);
    assert.ok(body.blockers.some((blocker) => blocker.code === "clock_model_unavailable"));
  });
});

test("the printed report contains no absolute filesystem path", () => {
  withRoot((roots) => {
    const result = run(["evaluate", "--plan", PLAN], roots);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(roots.root), "a repository-private path leaked into the report");
    assert.ok(!result.stdout.includes(FIXTURES));
    assert.ok(!/"\/[A-Za-z]/.test(result.stdout), "an absolute path leaked into the report");
  });
});

test("evaluate can target a named plan inside a scenario file and labels it official MODE", () => {
  withRoot((roots) => {
    const result = run(["evaluate", "--plan", `${OFFICIAL_SCENARIO}#plan`], roots);
    assert.equal(result.status, 0, result.stderr);
    const body = parseOnlyJson(result.stdout).report;
    assert.equal(body.evaluationMode, "official");
    assert.notEqual(body.clockRef, null);
    // I2 (fix round 1): the CLI applies no round-timeout adjudicator -- nothing in this repository
    // produces one yet -- so the official strength CLAIM is withheld and the report says why. This
    // is the honest state of the pipeline, not a CLI defect: the claim becomes available the day an
    // adjudicator is wired in and passed through.
    assert.equal(body.officialStrengthClaim, false);
    assert.equal(body.strengthClaimWithheld, true);
    assert.equal(body.timeoutAdjudication.applied, false);
    assert.equal(body.timeoutAdjudication.applicable, true);
    assert.deepEqual(
      body.blockers.map((blocker) => blocker.code),
      ["round_timeout_unadjudicated"],
    );
  });
});

test("minor (fix round 1): the CLI declares its own error codes for Task 12 to reconcile", async () => {
  const cli = await import("./environment_evaluate.mjs");
  assert.deepEqual(cli.CLI_ERROR_CODES, [
    "argument_combination_invalid",
    "environment_plan_unreadable",
    "environment_plan_invalid",
    "environment_evaluate_failed",
  ]);
  assert.ok(Object.isFrozen(cli.CLI_ERROR_CODES));
  // Importing the module must NOT execute a command against the importer's own argv.
  assert.equal(typeof cli.main, "function");
});

test("evaluate requires an explicit plan selector and never defaults to SC or EN", () => {
  withRoot((roots) => {
    const bare = run(["evaluate"], roots);
    assert.equal(bare.status, 1);
    const error = parseOnlyJson(bare.stdout);
    assert.equal(error.status, "error");
    assert.equal(error.code, "argument_combination_invalid");
    assert.match(error.details.missing.join(","), /plan/);

    // No edition, alias or environment default exists anywhere in the CLI.
    const source = readFileSync(CLI, "utf8");
    const executable = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    for (const needle of ['"SC"', "'SC'", '"EN"', "'EN'", "SC/latest", "EN/latest"]) {
      assert.ok(!executable.includes(needle), `the CLI must not name ${needle}`);
    }
  });
});

test("every root and the clock are injected: no implicit results root, no implicit now", () => {
  withRoot((roots) => {
    const missingResults = cli(["evaluate", "--plan", PLAN, "--runner", RUNNER, "--cache-root", roots.cacheRoot, "--now", NOW]);
    assert.equal(missingResults.status, 1);
    assert.equal(parseOnlyJson(missingResults.stdout).code, "argument_combination_invalid");

    const missingRunner = cli(["evaluate", "--plan", PLAN, "--results-root", roots.resultsRoot, "--now", NOW]);
    assert.equal(missingRunner.status, 1);
    assert.equal(parseOnlyJson(missingRunner.stdout).code, "argument_combination_invalid");
  });
});

test("an unknown flag, an unknown command and a bad instant all fail closed with one JSON error", () => {
  withRoot((roots) => {
    for (const args of [
      ["evaluate", "--plan", PLAN, "--edition", "SC"],
      ["simulate", "--plan", PLAN],
      ["evaluate", "--plan", PLAN, "--now", "yesterday"],
      ["evaluate", "--plan", PLAN, "--plan", PLAN],
    ]) {
      const result = run(args, roots);
      assert.equal(result.status, 1, args.join(" "));
      const error = parseOnlyJson(result.stdout);
      assert.equal(error.status, "error", args.join(" "));
      assert.ok(typeof error.code === "string" && error.code.length > 0);
    }
  });
});

test("an absolute path in a failure payload is redacted, never echoed", () => {
  withRoot((roots) => {
    const result = run(["evaluate", "--plan", "/nonexistent/environment/plan.json"], roots);
    assert.equal(result.status, 1);
    const error = parseOnlyJson(result.stdout);
    assert.equal(error.code, "environment_plan_unreadable");
    // The selector IS reported (a human needs to know which one failed) but never as a real path.
    assert.equal(error.details.selector, "[redacted-path]");
    assert.ok(!result.stdout.includes("/nonexistent/"));
    assert.ok(!/"\/[A-Za-z]/.test(result.stdout));
  });
});

test("a partial field is reported as field_not_representative, never renormalized", () => {
  withRoot((roots) => {
    const result = run(["evaluate", "--plan", INCOMPLETE], roots);
    assert.equal(result.status, 1);
    const error = parseOnlyJson(result.stdout);
    assert.equal(error.code, "field_not_representative");
  });
});

/* ------------------------------------------------------------------ *
 * compare
 * ------------------------------------------------------------------ */

test("compare requires an explicit mode", () => {
  withRoot((roots) => {
    const result = run(["compare", "--plan", PAIRED], roots);
    assert.equal(result.status, 1);
    assert.equal(parseOnlyJson(result.stdout).code, "argument_combination_invalid");
  });
});

test("compare --mode variants pairs two arms of one scenario and reports a paired interval", () => {
  withRoot((roots) => {
    const result = run(["compare", "--mode", "variants", "--plan", PAIRED], roots);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseOnlyJson(result.stdout);
    assert.equal(payload.status, "ok");
    assert.equal(payload.command, "compare");
    assert.equal(payload.comparison.paired.join, "pairingKey_and_seed");
    assert.notEqual(payload.comparison.baseline.planHash, payload.comparison.variant.planHash);
    assert.equal(payload.comparison.baseline.manifestRef.manifestId, payload.comparison.variant.manifestRef.manifestId);
    assert.ok(payload.comparison.paired.play.lo < payload.comparison.paired.play.hi);
  });
});

test("compare --mode environments keeps both environments separate and blends nothing", () => {
  withRoot((roots) => {
    const result = run([
      "compare", "--mode", "environments",
      "--plan", PLAN,
      "--plan", `${OFFICIAL_SCENARIO}#plan`,
    ], roots);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseOnlyJson(result.stdout);
    assert.equal(payload.comparison.environments.length, 2);
    const [first, second] = payload.comparison.environments;
    assert.notEqual(first.manifestRef.manifestId, second.manifestRef.manifestId);
    assert.equal(first.evaluationMode, "diagnostic_estimate");
    assert.equal(second.evaluationMode, "official");
    for (const forbidden of ["blended", "pooled", "combined"]) {
      assert.ok(!result.stdout.includes(forbidden), forbidden);
    }
  });
});

test("compare --mode environments refuses a single environment", () => {
  withRoot((roots) => {
    const result = run(["compare", "--mode", "environments", "--plan", PLAN], roots);
    assert.equal(result.status, 1);
    assert.equal(parseOnlyJson(result.stdout).code, "report_comparison_invalid");
  });
});
