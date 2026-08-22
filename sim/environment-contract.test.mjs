// Task 10: pure contract tests for job validation and termination classification.
//
// This file imports ONLY ./environment-contract.mjs, which itself imports ONLY
// ../environment/canonical.mjs and ../environment/hash.mjs (the project's one canonical hashing
// implementation). It must run with plain `node --test`, with no vendored engine present, so the
// job/result contract can be verified independently of engine execution speed or availability.
//
// Fix round 1 also imports environment/deck.mjs's OWN gameplayHashForDeck once, ONLY to pin
// byte-equality against this module's replicated copy — that import is a test-only cross-check,
// not a dependency of environment-contract.mjs itself (which stays canonical.mjs + hash.mjs only).
import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_KIND,
  PLAN_KIND,
  RESULT_KIND,
  buildRawJobResult,
  classifyTermination,
  computeJobId,
  computePlanHash,
  gameplayHashForDeck,
  parseFirstPlayerValue,
  validateEnvironmentJob,
  validateRawJobResult,
} from "./environment-contract.mjs";
import { gameplayHashForDeck as canonicalGameplayHashForDeck } from "../environment/deck.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

const CANDIDATE_LEADER = "ST01-001";
const CANDIDATE_COUNTS = { "ST01-002": 4, "ST01-003": 4 };

function basePlan(overrides = {}) {
  const draft = {
    schemaVersion: 1,
    kind: PLAN_KIND,
    fixedSeat: "play",
    seeds: [1000, 1001, 1002],
    completedGameTarget: 3,
    strategyCandidate: "valueRanked",
    strategyOpponent: "valueRanked",
    engineRevision: "engine-commit-fixture",
    maxCommands: 800,
    maxTurns: 40,
    ...overrides,
  };
  return { ...draft, planHash: computePlanHash(draft) };
}

// C1 fix round 1: gameplayHash is now recomputed and cross-checked by assertDeckInput, so every
// fixture deck must carry a GENUINE hash of its own { leaderGameplayId, mainDeckCounts } — a fake
// placeholder here would make every "well-formed job" test fail for the wrong reason.
function baseDeckInput(overrides = {}) {
  const leaderGameplayId = overrides.leaderGameplayId ?? CANDIDATE_LEADER;
  const mainDeckCounts = overrides.mainDeckCounts ?? CANDIDATE_COUNTS;
  return {
    displayName: "Fixture deck",
    leaderGameplayId,
    mainDeckCounts,
    artifactHash: HASH_A,
    gameplayHash: gameplayHashForDeck(leaderGameplayId, mainDeckCounts),
    ...overrides,
  };
}

function baseJob({ planOverrides = {}, candidateOverrides = {}, opponentOverrides = {} } = {}) {
  const plan = basePlan(planOverrides);
  const candidate = baseDeckInput(candidateOverrides);
  const opponent = baseDeckInput({ artifactHash: HASH_C, ...opponentOverrides });
  const draft = { schemaVersion: 1, kind: JOB_KIND, plan, candidate, opponent };
  return { ...draft, jobId: computeJobId(draft) };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

function codeOf(fn) {
  return errorOf(fn).code;
}

function reasonOf(fn) {
  return errorOf(fn).details?.reason;
}

function baseGames(job, { outcome = "win" } = {}) {
  const fixedSeat = job.plan.fixedSeat;
  const actualSeat = fixedSeat === "play" ? "north" : "south";
  const aOnPlay = fixedSeat === "play";
  return job.plan.seeds.map((seed) => ({
    seed,
    requestedSeat: fixedSeat,
    actualSeat,
    aOnPlay,
    outcome,
    engineTermination: "rules-win",
    terminationCause: "rules-win",
    turns: 9,
    commands: 42,
  }));
}

// ---------------------------------------------------------------------------
// classifyTermination — the three verbatim brief assertions, plus the rest of the ordering table.
// ---------------------------------------------------------------------------

test("classifyTermination: illegal-command beats a stale turn ceiling (non-rules-win checked first)", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "illegal-command",
      winner: null,
      turns: 99,
      maxTurns: 40,
    }),
    { outcome: "tool_failure", terminationCause: "illegal-command" },
  );
});

test("classifyTermination: a rules-win outside the turn budget is unfinished, not a win", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "candidate",
      turns: 41,
      maxTurns: 40,
    }),
    { outcome: "unfinished", terminationCause: "turn_budget_exhausted" },
  );
});

test("classifyTermination: a rules-win inside the turn budget is a real win", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "candidate",
      turns: 9,
      maxTurns: 40,
    }),
    { outcome: "win", terminationCause: "rules-win" },
  );
});

test("classifyTermination: turns exactly AT maxTurns is still within budget (off-by-one boundary, mutation survivor b)", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "candidate",
      turns: 40,
      maxTurns: 40,
    }),
    { outcome: "win", terminationCause: "rules-win" },
  );
  // And one turn past the boundary flips it, proving the boundary itself (not just "big turns
  // fail") is where the check actually sits.
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "candidate",
      turns: 41,
      maxTurns: 40,
    }),
    { outcome: "unfinished", terminationCause: "turn_budget_exhausted" },
  );
});

test("classifyTermination: a rules-win for the opponent is a loss for the candidate", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "opponent",
      turns: 9,
      maxTurns: 40,
    }),
    { outcome: "loss", terminationCause: "rules-win" },
  );
});

test("classifyTermination: repeated-state is a computational ceiling, not a tool failure", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "repeated-state",
      winner: null,
      turns: 12,
      maxTurns: 40,
    }),
    { outcome: "unfinished", terminationCause: "repeated-state" },
  );
});

test("classifyTermination: max-actions (the engine's own command ceiling) is unfinished", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "max-actions",
      winner: null,
      turns: 12,
      maxTurns: 40,
    }),
    { outcome: "unfinished", terminationCause: "max-actions" },
  );
});

test("classifyTermination: unsupported-prompt is a tool failure with its exact cause retained", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "unsupported-prompt",
      winner: null,
      turns: 3,
      maxTurns: 40,
    }),
    { outcome: "tool_failure", terminationCause: "unsupported-prompt" },
  );
});

test("classifyTermination: an unrecognized/unknown engine cause fails closed to tool_failure", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "infrastructure-error",
      winner: null,
      turns: 3,
      maxTurns: 40,
    }),
    { outcome: "tool_failure", terminationCause: "infrastructure-error" },
  );
});

test("classifyTermination: rules-win with no winner is a contradictory state, not a win", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: null,
      turns: 9,
      maxTurns: 40,
    }),
    { outcome: "tool_failure", terminationCause: "contradictory-winner-state" },
  );
});

test("classifyTermination: a command ceiling breach inside the turn budget is still unfinished", () => {
  assert.deepEqual(
    classifyTermination({
      engineTermination: "rules-win",
      winner: "candidate",
      turns: 9,
      maxTurns: 40,
      commands: 900,
      maxCommands: 800,
    }),
    { outcome: "unfinished", terminationCause: "command_budget_exhausted" },
  );
});

test("classifyTermination: never produces round_timeout (exact literal) — that is Task 11's clock-adapter concern", () => {
  assert.equal(
    codeOf(() =>
      classifyTermination({
        engineTermination: "round_timeout",
        winner: null,
        turns: 41,
        maxTurns: 40,
      }),
    ),
    "round_timeout_forbidden",
  );
});

test("classifyTermination: rejects laundered round_timeout spellings too (I1 fix round 1)", () => {
  for (const spelling of ["round-timeout", "ROUND_TIMEOUT", " round_timeout ", "Round-Timeout"]) {
    assert.equal(
      codeOf(() =>
        classifyTermination({ engineTermination: spelling, winner: null, turns: 41, maxTurns: 40 }),
      ),
      "round_timeout_forbidden",
      `spelling not caught: ${JSON.stringify(spelling)}`,
    );
  }
});

test("classifyTermination: rejects malformed input rather than guessing", () => {
  assert.equal(codeOf(() => classifyTermination({ winner: null, turns: 1, maxTurns: 40 })), "termination_input_invalid");
  assert.equal(
    codeOf(() => classifyTermination({ engineTermination: "rules-win", winner: "north", turns: 1, maxTurns: 40 })),
    "termination_input_invalid",
  );
  assert.equal(
    codeOf(() => classifyTermination({ engineTermination: "rules-win", winner: null, turns: -1, maxTurns: 40 })),
    "termination_input_invalid",
  );
});

// ---------------------------------------------------------------------------
// parseFirstPlayerValue — shared by legacy --first parsing and job.plan.fixedSeat validation.
// ---------------------------------------------------------------------------

test("parseFirstPlayerValue accepts play, draw, and alternate", () => {
  assert.equal(parseFirstPlayerValue("play"), "play");
  assert.equal(parseFirstPlayerValue("draw"), "draw");
  assert.equal(parseFirstPlayerValue("alternate"), "alternate");
});

test("parseFirstPlayerValue: an invalid value like 'banana' is invalid_first_player, never a silent alternate", () => {
  assert.equal(codeOf(() => parseFirstPlayerValue("banana")), "invalid_first_player");
  assert.equal(codeOf(() => parseFirstPlayerValue("")), "invalid_first_player");
  assert.equal(codeOf(() => parseFirstPlayerValue(undefined)), "invalid_first_player");
});

// ---------------------------------------------------------------------------
// gameplayHashForDeck — replicated for harness dependency minimality (C1 fix round 1); must be
// byte-identical to environment/deck.mjs's canonical implementation, forever.
// ---------------------------------------------------------------------------

test("gameplayHashForDeck matches environment/deck.mjs's canonical implementation byte-for-byte", () => {
  const cases = [
    ["ST01-001", { "ST01-002": 4, "ST01-003": 4 }],
    ["OP16-001", { "OP16-002": 1, "OP16-003": 2, "OP16-020": 4 }],
    ["ST01-001", { "ST01-003": 4, "ST01-002": 4 }], // reordered input, same content
    ["OP14-020", { "OP14-021": 1 }],
  ];
  for (const [leaderGameplayId, mainDeckCounts] of cases) {
    assert.equal(
      gameplayHashForDeck(leaderGameplayId, mainDeckCounts),
      canonicalGameplayHashForDeck(leaderGameplayId, mainDeckCounts),
      `diverged for ${leaderGameplayId}`,
    );
  }
});

// ---------------------------------------------------------------------------
// validateEnvironmentJob — one fixed seat, unique integer seeds, positive completed target,
// deck artifact/gameplay hashes, plan hash, job ID, strategies, engine revision, limits.
// ---------------------------------------------------------------------------

test("validateEnvironmentJob accepts a well-formed play job and returns it", () => {
  const job = baseJob();
  assert.equal(validateEnvironmentJob(job), job);
});

test("validateEnvironmentJob accepts a well-formed draw job", () => {
  const job = baseJob({ planOverrides: { fixedSeat: "draw" } });
  assert.equal(validateEnvironmentJob(job).plan.fixedSeat, "draw");
});

test("validateEnvironmentJob rejects a non-object job", () => {
  assert.equal(codeOf(() => validateEnvironmentJob(null)), "environment_job_invalid");
  assert.equal(codeOf(() => validateEnvironmentJob("job")), "environment_job_invalid");
});

test("validateEnvironmentJob rejects an unsupported schemaVersion", () => {
  const job = { ...baseJob(), schemaVersion: 2 };
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_schema_unsupported");
});

test("validateEnvironmentJob rejects the wrong top-level kind", () => {
  const job = { ...baseJob(), kind: "not-a-job" };
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_invalid");
});

test("validateEnvironmentJob rejects alternate as a job fixedSeat — jobs must pin play or draw", () => {
  const plan = basePlan({ fixedSeat: "alternate" });
  const draft = { schemaVersion: 1, kind: JOB_KIND, plan, candidate: baseDeckInput(), opponent: baseDeckInput({ artifactHash: HASH_C }) };
  const job = { ...draft, jobId: computeJobId(draft) };
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_fixed_seat_alternate_forbidden");
});

test("validateEnvironmentJob rejects an unrecognized fixedSeat value as invalid_first_player", () => {
  // fixedSeat is validated before planHash/jobId recomputation would even matter, so the raw
  // (uncomputed) hashes below are irrelevant to what this test is proving.
  const plan = { ...basePlan(), fixedSeat: "banana" };
  const job = { schemaVersion: 1, kind: JOB_KIND, plan, candidate: baseDeckInput(), opponent: baseDeckInput({ artifactHash: HASH_C }), jobId: HASH_A };
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "invalid_first_player");
});

test("validateEnvironmentJob rejects an empty seed list", () => {
  const job = baseJob({ planOverrides: { seeds: [], completedGameTarget: 1 } });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_seeds_empty");
});

test("validateEnvironmentJob rejects a non-integer seed", () => {
  const job = baseJob({ planOverrides: { seeds: [1000, 1000.5, 1002] } });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_seed_invalid");
});

test("validateEnvironmentJob rejects a seed given as a numeric string (no coercion)", () => {
  const job = baseJob({ planOverrides: { seeds: [1000, "1001", 1002] } });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_seed_invalid");
});

test("validateEnvironmentJob rejects duplicate seeds", () => {
  const job = baseJob({ planOverrides: { seeds: [1000, 1001, 1000] } });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_seed_duplicate");
});

test("validateEnvironmentJob treats 0 and -0 as the same seed (duplicate)", () => {
  const job = baseJob({ planOverrides: { seeds: [0, -0, 1001], completedGameTarget: 2 } });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_seed_duplicate");
});

test("validateEnvironmentJob rejects a non-positive completedGameTarget", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { completedGameTarget: 0 } }))),
    "environment_job_completed_target_invalid",
  );
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { completedGameTarget: -1 } }))),
    "environment_job_completed_target_invalid",
  );
});

test("validateEnvironmentJob rejects a completedGameTarget greater than the unique seed count", () => {
  const job = baseJob({ planOverrides: { completedGameTarget: 4 } }); // only 3 seeds
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_completed_target_invalid");
});

test("validateEnvironmentJob requires the candidate's artifact and gameplay hashes", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ candidateOverrides: { artifactHash: "not-a-hash" } }))),
    "environment_job_hash_invalid",
  );
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ candidateOverrides: { gameplayHash: "sha256:short" } }))),
    "environment_job_hash_invalid",
  );
});

test("validateEnvironmentJob requires the opponent's artifact and gameplay hashes", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ opponentOverrides: { artifactHash: "" } }))),
    "environment_job_hash_invalid",
  );
});

test("validateEnvironmentJob rejects a deck with an empty mainDeckCounts", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ candidateOverrides: { mainDeckCounts: {} } }))),
    "environment_job_deck_invalid",
  );
});

test("validateEnvironmentJob rejects a deck with a non-positive card count", () => {
  assert.equal(
    codeOf(() =>
      validateEnvironmentJob(baseJob({ candidateOverrides: { mainDeckCounts: { "ST01-002": 0 } } })),
    ),
    "environment_job_deck_invalid",
  );
});

test("validateEnvironmentJob requires non-empty strategy names", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { strategyCandidate: "" } }))),
    "environment_job_invalid",
  );
});

test("validateEnvironmentJob requires a git-shaped engineRevision or the fixture placeholder", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { engineRevision: "not a revision" } }))),
    "environment_job_engine_revision_invalid",
  );
  // The fixture placeholder used elsewhere in this project's capability tooling must be accepted.
  assert.doesNotThrow(() =>
    validateEnvironmentJob(baseJob({ planOverrides: { engineRevision: "engine-commit-fixture" } })),
  );
});

test("validateEnvironmentJob requires positive safe integer limits", () => {
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { maxCommands: 0 } }))),
    "environment_job_limit_invalid",
  );
  assert.equal(
    codeOf(() => validateEnvironmentJob(baseJob({ planOverrides: { maxTurns: -5 } }))),
    "environment_job_limit_invalid",
  );
});

test("validateEnvironmentJob rejects a tampered plan whose planHash was not recomputed", () => {
  const job = baseJob();
  const tampered = { ...job, plan: { ...job.plan, maxTurns: 999 } }; // planHash now stale
  assert.equal(codeOf(() => validateEnvironmentJob(tampered)), "environment_job_plan_hash_mismatch");
});

test("validateEnvironmentJob rejects a tampered job whose jobId was not recomputed", () => {
  const job = baseJob();
  const plan = { ...job.plan, maxCommands: 801 };
  plan.planHash = computePlanHash(plan); // planHash kept honest; jobId is now the stale one
  const tampered = { ...job, plan };
  assert.equal(codeOf(() => validateEnvironmentJob(tampered)), "environment_job_id_mismatch");
});

test("validateEnvironmentJob rejects a caller who swapped in a different deck without updating jobId", () => {
  // artifactHash is NOT recomputed by assertDeckInput (only gameplayHash is, per C1) — tampering it
  // in isolation exercises the jobId-staleness check specifically, without also tripping the new
  // gameplayHash-recomputation guard (that guard has its own dedicated tests below).
  const job = baseJob();
  const tampered = { ...job, candidate: { ...job.candidate, artifactHash: `sha256:${"9".repeat(64)}` } };
  assert.equal(codeOf(() => validateEnvironmentJob(tampered)), "environment_job_id_mismatch");
});

// ---------------------------------------------------------------------------
// C1 (Critical, fix round 1): the deck the engine actually plays must be bound to gameplayHash —
// mutating mainDeckCounts or leaderGameplayId while leaving gameplayHash untouched is rejected.
// ---------------------------------------------------------------------------

test("validateEnvironmentJob rejects mainDeckCounts mutated (e.g. an added card) while gameplayHash stays the old one (C1)", () => {
  const honest = baseDeckInput();
  const tamperedCounts = { ...honest.mainDeckCounts, "ST01-004": 1 }; // a card that wasn't there before
  const tampered = { ...honest, mainDeckCounts: tamperedCounts }; // gameplayHash NOT recomputed
  const job = baseJob({ candidateOverrides: tampered });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_deck_hash_mismatch");
});

test("validateEnvironmentJob rejects a swapped leaderGameplayId while gameplayHash stays the old one (C1)", () => {
  const honest = baseDeckInput();
  const tampered = { ...honest, leaderGameplayId: "OP16-001" }; // gameplayHash NOT recomputed
  const job = baseJob({ candidateOverrides: tampered });
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_deck_hash_mismatch");
});

test("validateEnvironmentJob accepts an HONEST deck whose gameplayHash was correctly recomputed after a real change (C1 positive control)", () => {
  const changedCounts = { "ST01-002": 4, "ST01-003": 4, "ST01-004": 1 };
  const job = baseJob({
    candidateOverrides: {
      mainDeckCounts: changedCounts,
      gameplayHash: gameplayHashForDeck(CANDIDATE_LEADER, changedCounts),
    },
  });
  assert.equal(validateEnvironmentJob(job), job);
});

// ---------------------------------------------------------------------------
// I3 (Important, fix round 1): closed key sets on job, job.plan, job.candidate, job.opponent — a
// mutable caller deck path or any other unlisted field is rejected, independent of hash
// consistency (an attacker who controls the whole job can always recompute a hash to match).
// ---------------------------------------------------------------------------

test("validateEnvironmentJob rejects an unknown key on job.candidate, e.g. a mutable deck path (I3)", () => {
  const job = baseJob();
  const tampered = { ...job, candidate: { ...job.candidate, deckPath: "/tmp/attacker-controlled.json" } };
  assert.equal(codeOf(() => validateEnvironmentJob(tampered)), "environment_job_unknown_key");
});

test("validateEnvironmentJob rejects an unknown top-level key, e.g. candidateDeckFile (I3)", () => {
  const job = { ...baseJob(), candidateDeckFile: "/tmp/attacker-controlled.json" };
  assert.equal(codeOf(() => validateEnvironmentJob(job)), "environment_job_unknown_key");
});

test("validateEnvironmentJob rejects an unknown key on job.plan even with an HONESTLY recomputed planHash (I3)", () => {
  // Proves this is independent of hash consistency: the attacker recomputes planHash correctly
  // over their own extra field, and jobId does not read unknown fields at all, so only the closed
  // key set catches it.
  const job = baseJob();
  const planDraft = { ...job.plan, deckPathCandidate: "/tmp/attacker-controlled.json" };
  delete planDraft.planHash;
  const planWithExtra = { ...planDraft, planHash: computePlanHash(planDraft) };
  const tampered = { ...job, plan: planWithExtra };
  assert.equal(codeOf(() => validateEnvironmentJob(tampered)), "environment_job_unknown_key");
});

// ---------------------------------------------------------------------------
// (e) mutation survivor: table-driven computeJobId — EVERY projection field must change the
// jobId when perturbed alone. The opponent-hash fields were previously untested (no existing test
// mutated job.opponent.* and checked jobId), so a mutant that dropped the `opponent: {...}` block
// from the hashed projection would have gone undetected despite the code being correct today.
// ---------------------------------------------------------------------------

test("computeJobId changes when ANY single projection field changes, table-driven (mutation survivor e)", () => {
  const job = baseJob();
  const baseId = computeJobId(job);

  const perturbations = {
    "plan.planHash": { ...job, plan: { ...job.plan, planHash: `sha256:${"9".repeat(64)}` } },
    "plan.fixedSeat": { ...job, plan: { ...job.plan, fixedSeat: "draw" } },
    "plan.seeds": { ...job, plan: { ...job.plan, seeds: [...job.plan.seeds, 9999] } },
    "plan.strategyCandidate": { ...job, plan: { ...job.plan, strategyCandidate: "greedy" } },
    "plan.strategyOpponent": { ...job, plan: { ...job.plan, strategyOpponent: "greedy" } },
    "plan.completedGameTarget": { ...job, plan: { ...job.plan, completedGameTarget: 1 } },
    "plan.engineRevision": { ...job, plan: { ...job.plan, engineRevision: "0".repeat(40) } },
    "plan.maxCommands": { ...job, plan: { ...job.plan, maxCommands: 801 } },
    "plan.maxTurns": { ...job, plan: { ...job.plan, maxTurns: 41 } },
    "candidate.artifactHash": { ...job, candidate: { ...job.candidate, artifactHash: `sha256:${"7".repeat(64)}` } },
    "candidate.gameplayHash": { ...job, candidate: { ...job.candidate, gameplayHash: `sha256:${"8".repeat(64)}` } },
    "opponent.artifactHash": { ...job, opponent: { ...job.opponent, artifactHash: `sha256:${"5".repeat(64)}` } },
    "opponent.gameplayHash": { ...job, opponent: { ...job.opponent, gameplayHash: `sha256:${"6".repeat(64)}` } },
  };

  for (const [label, perturbedJob] of Object.entries(perturbations)) {
    const perturbedId = computeJobId(perturbedJob);
    assert.notEqual(perturbedId, baseId, `perturbing ${label} did not change the jobId`);
  }
});

// ---------------------------------------------------------------------------
// validateRawJobResult — provenance echo, seed schedule, seat/aOnPlay agreement with fixedSeat,
// termination consistency, and the completed-game floor. Never round_timeout.
// ---------------------------------------------------------------------------

test("validateRawJobResult accepts a genuine matching result for a play job", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job, { outcome: "win" });
  const result = buildRawJobResult(job, games);
  assert.equal(validateRawJobResult(job, result), result);
});

test("validateRawJobResult accepts a genuine matching result for a draw job", () => {
  const job = validateEnvironmentJob(baseJob({ planOverrides: { fixedSeat: "draw" } }));
  const games = baseGames(job, { outcome: "loss" });
  const result = buildRawJobResult(job, games);
  assert.equal(validateRawJobResult(job, result), result);
});

test("validateRawJobResult rejects a result whose content hash was not recomputed — isolated to ONLY the hash check (mutation survivor a)", () => {
  const job = validateEnvironmentJob(baseJob());
  const result = buildRawJobResult(job, baseGames(job));
  // `turns` on a game row is not independently cross-checked by ANY other guard in this function,
  // so this tamper can be caught ONLY by resultHash recomputation. (The previous version of this
  // test tampered top-level `maxTurns`, which settings_mismatch ALSO catches, and asserted only the
  // generic `.code` — so deleting the resultHash check entirely still left it green.)
  const tamperedGames = result.games.map((g, i) => (i === 0 ? { ...g, turns: g.turns + 1 } : g));
  const tampered = { ...result, games: tamperedGames };
  const error = errorOf(() => validateRawJobResult(job, tampered));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "result_hash_mismatch");
});

test("validateRawJobResult rejects a result carrying a different job's jobId", () => {
  const job = validateEnvironmentJob(baseJob());
  const otherJob = validateEnvironmentJob(baseJob({ planOverrides: { seeds: [5000, 5001, 5002] } }));
  const result = buildRawJobResult(otherJob, baseGames(otherJob));
  const errorCode = codeOf(() => validateRawJobResult(job, result));
  assert.equal(errorCode, "simulation_result_mismatch");
});

test("validateRawJobResult rejects a result missing a seed from the exact schedule", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job).slice(0, 2); // dropped the third seed
  const result = buildRawJobResult({ ...job, plan: { ...job.plan } }, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects a result whose seeds are reordered relative to the job", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  const reordered = [games[1], games[0], games[2]];
  const result = buildRawJobResult(job, reordered);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects requestedSeat drift from the job's fixedSeat", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[0].requestedSeat = "draw";
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects an actualSeat inconsistent with a play job (must be north)", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[1].actualSeat = "south";
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects an actualSeat inconsistent with a draw job (must be south)", () => {
  const job = validateEnvironmentJob(baseJob({ planOverrides: { fixedSeat: "draw" } }));
  const games = baseGames(job);
  games[0].actualSeat = "north";
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects aOnPlay=false anywhere in a play job — read back, never assumed", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[2].aOnPlay = false;
  const result = buildRawJobResult(job, games);
  const errorCode = codeOf(() => validateRawJobResult(job, result));
  assert.equal(errorCode, "simulation_result_mismatch");
});

test("validateRawJobResult rejects aOnPlay=true anywhere in a draw job", () => {
  const job = validateEnvironmentJob(baseJob({ planOverrides: { fixedSeat: "draw" } }));
  const games = baseGames(job);
  games[0].aOnPlay = true;
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult rejects round_timeout (exact literal) wherever it appears — Task 10 never produces it (mutation survivor c)", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[0].outcome = "round_timeout";
  const result = buildRawJobResult(job, games);
  const error = errorOf(() => validateRawJobResult(job, result));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "round_timeout_present");
});

test("validateRawJobResult rejects laundered round_timeout spellings in terminationCause (I1)", () => {
  for (const spelling of ["round-timeout", "ROUND_TIMEOUT", " round_timeout ", "Round_Timeout"]) {
    const job = validateEnvironmentJob(baseJob());
    const games = baseGames(job);
    games[0].terminationCause = spelling;
    const result = buildRawJobResult(job, games);
    const error = errorOf(() => validateRawJobResult(job, result));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "round_timeout_present", `spelling not caught: ${JSON.stringify(spelling)}`);
  }
});

test("validateRawJobResult rejects round_timeout laundered through engineTermination, even with an innocuous terminationCause (I1)", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[0].engineTermination = "ROUND_TIMEOUT";
  // terminationCause deliberately left as "rules-win" — the exact laundering attempt I1 describes.
  const result = buildRawJobResult(job, games);
  const error = errorOf(() => validateRawJobResult(job, result));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "round_timeout_present");
});

test("validateRawJobResult rejects a plain invalid outcome as outcome_invalid, distinct from round_timeout_present (M2)", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[0].outcome = "garbage"; // not round-timeout-shaped, and not in RAW_OUTCOMES
  const result = buildRawJobResult(job, games);
  const error = errorOf(() => validateRawJobResult(job, result));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "outcome_invalid");
});

test("validateRawJobResult rejects an outcome/terminationCause pairing that is not internally consistent", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  games[0].outcome = "win";
  games[0].terminationCause = "turn_budget_exhausted"; // a ceiling cause cannot be a win
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult enforces the completed-game floor — unfinished/tool_failure never satisfy it", () => {
  const job = validateEnvironmentJob(baseJob({ planOverrides: { completedGameTarget: 3 } }));
  const games = baseGames(job);
  games[2] = {
    ...games[2],
    outcome: "unfinished",
    engineTermination: "max-actions",
    terminationCause: "max-actions",
  };
  const result = buildRawJobResult(job, games);
  assert.equal(codeOf(() => validateRawJobResult(job, result)), "simulation_result_mismatch");
});

test("validateRawJobResult accepts fewer clean completions only when the target already allows it", () => {
  const job = validateEnvironmentJob(baseJob({ planOverrides: { completedGameTarget: 2 } }));
  const games = baseGames(job);
  games[2] = {
    ...games[2],
    outcome: "tool_failure",
    engineTermination: "illegal-command",
    terminationCause: "illegal-command",
  };
  const result = buildRawJobResult(job, games);
  assert.equal(validateRawJobResult(job, result), result);
});

test("buildRawJobResult output is content-addressed: identical inputs give an identical resultHash", () => {
  const job = validateEnvironmentJob(baseJob());
  const games = baseGames(job);
  const first = buildRawJobResult(job, games);
  const second = buildRawJobResult(job, baseGames(job));
  assert.equal(first.resultHash, second.resultHash);
  assert.match(first.resultHash, /^sha256:[0-9a-f]{64}$/);
});

test("buildRawJobResult output kind and jobId/planHash echo the source job exactly", () => {
  const job = validateEnvironmentJob(baseJob());
  const result = buildRawJobResult(job, baseGames(job));
  assert.equal(result.kind, RESULT_KIND);
  assert.equal(result.jobId, job.jobId);
  assert.equal(result.planHash, job.plan.planHash);
  assert.deepEqual(result.seeds, job.plan.seeds);
  assert.equal(result.games.length, job.plan.seeds.length);
});
