import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EnvironmentError } from "./errors.mjs";
import { hashProjection } from "./hash.mjs";
import { executeSimulationPlan, expandSimulationPlan } from "./simulation.mjs";
import {
  aggregateEnvironment,
  BOOTSTRAP_REPLICATES,
  BOOTSTRAP_SEED,
  compareEnvironments,
  compareVariants,
  weightedSeatEv,
  wilsonInterval,
} from "./report.mjs";
// B1 (fix round 1): the shared numeric primitives have ONE export face and it is matchup.mjs's.
// report.mjs used to re-export them, which put the same binding on two module faces.
import { assertExactCoverage, createXorshift32 } from "./matchup.mjs";
import { createFakeRunner } from "../tests/fixtures/environment/fake-simulation-runner.mjs";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../tests/fixtures/environment/${name}`, import.meta.url), "utf8"));
}

const diagnosticBundle = fixture("minimal-resolved-plan.json");
const timeoutScenario = fixture("accepted-clock-timeout-results.json");
const officialBundle = timeoutScenario.plan;
const pairedScenario = fixture("base-variant-paired-results.json");
const defaultScript = fixture("minimal-valid-results.json");

const NOW = "2026-08-21T10:00:00+08:00";
const ACE = "leader:OP16-001";
const TEACH = "leader:OP16-080";

function candidateDeckOf(bundle) {
  return bundle.deckSnapshots.find((deck) => deck.snapshotId === bundle.resolved.candidateDeckRef.snapshotId);
}

function planFor(bundle, overrides = {}) {
  return expandSimulationPlan(bundle.resolved, candidateDeckOf(bundle), {
    ...bundle.settings,
    opponentDecks: bundle.deckSnapshots,
    ...overrides,
  });
}

function failure(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentError) return error;
    throw error;
  }
  throw new assert.AssertionError({ message: "expected an EnvironmentError but none was thrown" });
}

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "environment-report-test-"));
  try {
    return run({
      cacheRoot: join(root, ".cache", "environment-jobs"),
      resultsRoot: join(root, "sim", "results", "environments"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runPlan(bundle, roots, { script = defaultScript, arm, timeoutAdjudication } = {}) {
  const plan = planFor(bundle);
  return executeSimulationPlan(plan, {
    runner: createFakeRunner(script, { arm }),
    cacheRoot: roots.cacheRoot,
    resultsRoot: roots.resultsRoot,
    now: NOW,
    timeoutAdjudication,
  });
}

/* ------------------------------------------------------------------ *
 * 1. exact coverage: no renormalization, anywhere
 * ------------------------------------------------------------------ */

test("field weights and every within-archetype weight set must sum to one within 1e-12", () => {
  const strata = officialBundle.resolved.strata;
  assert.equal(assertExactCoverage(strata), strata);

  const nudged = structuredClone(strata);
  nudged[0].fieldWeight += 2e-12;
  const error = failure(() => assertExactCoverage(nudged));
  assert.equal(error.code, "field_not_representative");
  assert.ok(Math.abs(error.details.sum - 1) > 1e-12);

  // Inside the tolerance, exactly at the documented boundary scale.
  const tolerated = structuredClone(strata);
  tolerated[0].fieldWeight += 1e-13;
  assert.ok(assertExactCoverage(tolerated));

  const splitRepresentatives = structuredClone(strata);
  splitRepresentatives[0].representatives = [
    { ...splitRepresentatives[0].representatives[0], withinArchetypeWeight: 0.5 },
  ];
  const repError = failure(() => assertExactCoverage(splitRepresentatives));
  assert.equal(repError.code, "field_not_representative");
  assert.equal(repError.details.reason, "representative_weights_unreconciled");
  assert.equal(repError.details.archetypeId, ACE);
});

test("a partial field returns field_not_representative and is never renormalized", () => {
  const incomplete = fixture("incomplete-field-plan.json");
  const error = failure(() => assertExactCoverage(incomplete.resolved.strata));
  assert.equal(error.code, "field_not_representative");
  // The remaining share is 0.4166..., which a renormalizing implementation would silently scale to 1.
  assert.ok(error.details.sum < 1);
  assert.equal(error.details.reason, "field_weights_unreconciled");
});

test("weightedSeatEv multiplies shares directly and never normalizes them", () => {
  const strata = [
    { archetypeId: "a", fieldWeight: 0.25, representatives: [{ withinArchetypeWeight: 1, winRate: { play: 0.6, draw: 0.4 } }] },
    {
      archetypeId: "b",
      fieldWeight: 0.75,
      representatives: [
        { withinArchetypeWeight: 0.5, winRate: { play: 0.5, draw: 0.5 } },
        { withinArchetypeWeight: 0.5, winRate: { play: 0.3, draw: 0.1 } },
      ],
    },
  ];
  assert.equal(weightedSeatEv(strata, "play"), 0.25 * 0.6 + 0.75 * (0.5 * 0.5 + 0.5 * 0.3));
  assert.equal(weightedSeatEv(strata, "draw"), 0.25 * 0.4 + 0.75 * (0.5 * 0.5 + 0.5 * 0.1));
  // The coverage assertion is inside weightedSeatEv, not a caller's responsibility.
  const partial = structuredClone(strata);
  partial[1].fieldWeight = 0.5;
  assert.equal(failure(() => weightedSeatEv(partial, "play")).code, "field_not_representative");
  assert.equal(failure(() => weightedSeatEv(strata, "north")).code, "report_input_invalid");
});

/* ------------------------------------------------------------------ *
 * 2. deterministic primitives
 * ------------------------------------------------------------------ */

test("the bootstrap settings are pinned constants, not knobs", () => {
  assert.equal(BOOTSTRAP_SEED, 20260820);
  assert.equal(BOOTSTRAP_REPLICATES, 10000);
});

test("xorshift32 is deterministic from the pinned seed", () => {
  const next = createXorshift32(BOOTSTRAP_SEED);
  assert.deepEqual(
    Array.from({ length: 8 }, () => next()),
    [472994643, 4248709054, 16158746, 2353173856, 53590263, 2982616800, 293456461, 2931029175],
  );
  const again = createXorshift32(BOOTSTRAP_SEED);
  assert.equal(again(), 472994643);
  assert.notEqual(createXorshift32(BOOTSTRAP_SEED + 1)(), 472994643);
  // A zero state would lock the generator at zero forever; it must be refused, not silently fixed.
  assert.equal(failure(() => createXorshift32(0)).code, "report_input_invalid");
});

test("the Wilson 95% interval matches its closed form and behaves at the boundaries", () => {
  // The independent derivation, including the [0, 1] clamp the contract requires.
  const wilson = (wins, n, z = 1.96) => {
    const p = wins / n;
    const denominator = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return {
      lo: Math.max(0, (centre - spread) / denominator),
      hi: Math.min(1, (centre + spread) / denominator),
    };
  };
  for (const [wins, n] of [[110, 200], [0, 200], [200, 200], [1, 3], [0, 5], [5, 5], [1, 5], [2, 7]]) {
    assert.deepEqual(wilsonInterval(wins, n), wilson(wins, n), `${wins}/${n}`);
  }
  const zero = wilsonInterval(0, 200);
  assert.equal(zero.lo, 0);
  assert.ok(zero.hi > 0, "a 0/200 interval is not the degenerate [0, 0] a normal approximation gives");
  const one = wilsonInterval(200, 200);
  assert.ok(one.lo < 1);
  assert.equal(one.hi, 1);

  // minor (fix round 1): at SMALL n the unclamped evaluation overshoots -- 0/5 lands at -3.1e-17 and
  // 5/5 at 1+2.2e-16. A published probability outside [0, 1] is a defect even at 1e-17, and the n=200
  // cases above cannot see it because they land exactly on the bounds.
  for (const n of [1, 2, 3, 5, 7, 11, 19]) {
    for (let wins = 0; wins <= n; wins += 1) {
      const interval = wilsonInterval(wins, n);
      assert.ok(interval.lo >= 0, `lo >= 0 for ${wins}/${n} (got ${interval.lo})`);
      assert.ok(interval.hi <= 1, `hi <= 1 for ${wins}/${n} (got ${interval.hi})`);
      assert.ok(interval.lo <= interval.hi, `${wins}/${n}`);
    }
  }
  assert.equal(wilsonInterval(0, 5).lo, 0);
  assert.equal(wilsonInterval(5, 5).hi, 1);

  assert.equal(failure(() => wilsonInterval(1, 0)).code, "report_input_invalid");
  assert.equal(failure(() => wilsonInterval(3, 2)).code, "report_input_invalid");
});

/* ------------------------------------------------------------------ *
 * 3. the simulated report
 * ------------------------------------------------------------------ */

const RATES = {
  [`${ACE}|play`]: 110 / 200,
  [`${ACE}|draw`]: 96 / 200,
  [`${TEACH}|play`]: 120 / 200,
  [`${TEACH}|draw`]: 88 / 200,
};

function expectedSeatEv(seat, rates = RATES) {
  return officialBundle.resolved.strata.reduce((total, row) => (
    total + row.fieldWeight * row.representatives.reduce((inner, representative) => (
      inner + representative.withinArchetypeWeight * rates[`${row.archetypeId}|${seat}`]
    ), 0)
  ), 0);
}

test("a simulated report exposes exact play and draw EV first, and overall only from Manifest weights", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const report = aggregateEnvironment({ ...outcome, now: NOW });

    assert.equal(report.ev.play, expectedSeatEv("play"));
    assert.equal(report.ev.draw, expectedSeatEv("draw"));
    assert.deepEqual(report.ev.turnOrderWeights, officialBundle.resolved.turnOrderWeights);
    assert.equal(
      report.ev.overall,
      officialBundle.resolved.turnOrderWeights.play * report.ev.play
        + officialBundle.resolved.turnOrderWeights.draw * report.ev.draw,
    );
    assert.equal(report.method, "simulated");
    assert.equal(report.applicability, "native");
    assert.equal(report.evaluationMode, "official");
    // I2 (fix round 1): official MODE, but no adjudicator ran, so the strength CLAIM is withheld.
    // See the dedicated I2 tests below.
    assert.equal(report.officialStrengthClaim, false);
    assert.equal(report.coverage.status, "complete");
    assert.equal(report.coverage.cells, 4);
    assert.equal(report.coverage.requiredCells, 4);
  });
});

test("EV_overall is refused when the Manifest states no explicit turn-order weights", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    for (const turnOrderWeights of [undefined, null, { play: 0.5 }, { play: 0.6, draw: 0.5 }]) {
      const plan = { ...outcome.plan, turnOrderWeights };
      const error = failure(() => aggregateEnvironment({ ...outcome, plan, now: NOW }));
      assert.equal(error.code, "report_input_invalid", JSON.stringify(turnOrderWeights));
      assert.equal(error.details.field, "turnOrderWeights");
    }
  });
});

test("a win scores 1, a loss 0, and an accepted-clock round timeout 0 inside the same denominator", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs) {
      const key = `${job.archetypeId}|${job.seat}`;
      const indexes = timeoutScenario.timeoutAdjudication.cells[key]?.timedOutSeedIndexes ?? [];
      cells[job.pairingKey] = {
        timedOutSeeds: indexes.map((index) => job.seeds[index]),
        evaluatedSeeds: job.seeds.length,
      };
    }
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(timeoutScenario.runnerScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    });
    const report = aggregateEnvironment({ ...outcome, now: NOW });
    const rates = {
      [`${ACE}|play`]: 105 / 200,
      [`${ACE}|draw`]: 96 / 200,
      [`${TEACH}|play`]: 120 / 200,
      [`${TEACH}|draw`]: 88 / 200,
    };
    assert.equal(report.ev.play, expectedSeatEv("play", rates));
    assert.equal(report.ev.draw, expectedSeatEv("draw", rates));

    const acePlay = report.strata
      .find((row) => row.archetypeId === ACE)
      .representatives[0].seats.play;
    assert.equal(acePlay.wins, 105);
    assert.equal(acePlay.losses, 90);
    assert.equal(acePlay.scoredRoundTimeouts, 5);
    assert.equal(acePlay.validGames, 200);
    assert.equal(acePlay.winRate, 105 / 200);
    assert.equal(acePlay.roundTimeout.timeoutScoring, "double-loss");
  });
});

test("a report refuses to score when any required cell is absent, and never renormalizes what is left", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const error = failure(() => aggregateEnvironment({
      ...outcome,
      results: outcome.results.filter((record) => !(record.archetypeId === TEACH && record.seat === "draw")),
      now: NOW,
    }));
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "incomplete_seat_coverage");
  });
});

test("a duplicate cell for one stratum and seat is refused rather than averaged", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const error = failure(() => aggregateEnvironment({
      ...outcome,
      results: [...outcome.results, outcome.results[0]],
      now: NOW,
    }));
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "duplicate_cell");
  });
});

test("each cell carries its own Wilson interval and the report labels what its intervals exclude", () => {
  withRoot((roots) => {
    const report = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    const acePlay = report.strata.find((row) => row.archetypeId === ACE).representatives[0].seats.play;
    assert.deepEqual(acePlay.wilson95, wilsonInterval(110, 200));
    assert.equal(report.confidence.label, "simulationMonteCarlo95");
    assert.equal(report.confidence.seed, 20260820);
    assert.equal(report.confidence.replicates, 10000);
    assert.deepEqual(report.confidence.excludes, [
      "field_selection_uncertainty",
      "deck_choice_uncertainty",
      "pilot_skill_uncertainty",
      "engine_fidelity_uncertainty",
      "clock_model_uncertainty",
    ]);
    for (const seat of ["play", "draw", "overall"]) {
      const interval = report.confidence[seat];
      assert.ok(interval.lo < interval.hi, seat);
      assert.ok(interval.lo <= report.ev[seat] && report.ev[seat] <= interval.hi, seat);
      assert.ok(interval.hi - interval.lo < 0.2, seat);
    }
  });
});

test("the aggregate interval is deterministic and resamples within each stratum and seat", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const first = aggregateEnvironment({ ...outcome, now: NOW });
    const second = aggregateEnvironment({ ...outcome, now: "2026-09-01T00:00:00+08:00" });
    assert.deepEqual(second.confidence.play, first.confidence.play);
    assert.deepEqual(second.confidence.draw, first.confidence.draw);
    assert.deepEqual(second.confidence.overall, first.confidence.overall);
    // The pinned interval itself, so a change to the resampler or the RNG cannot pass silently.
    assert.deepEqual(first.confidence.play, { lo: 0.5295833333333334, hi: 0.6275 });
    assert.deepEqual(first.confidence.draw, { lo: 0.40750000000000003, hi: 0.5066666666666667 });
    assert.deepEqual(first.confidence.overall, { lo: 0.483125, hi: 0.5527083333333334 });
    // The field and representative weights are HELD FIXED: they never appear in the resample.
    assert.equal(first.confidence.weightsResampled, false);
  });
});

test("the report content hash covers every immutable input but excludes the runtime timestamp", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const first = aggregateEnvironment({ ...outcome, now: NOW });
    const later = aggregateEnvironment({ ...outcome, now: "2026-09-01T00:00:00+08:00" });
    assert.notEqual(first.generatedAt, later.generatedAt);
    assert.equal(first.contentHash, later.contentHash);
    assert.equal(first.contentHash, hashProjection(first, ["contentHash", "generatedAt"]));

    // ...and it does move when an immutable input, a gate label or a result value moves.
    const others = [
      { plan: { ...outcome.plan, evaluationMode: "diagnostic_estimate", officialStrengthClaim: false, blockers: [{ code: "clock_model_unavailable" }] } },
      { plan: { ...outcome.plan, manifestRef: { ...outcome.plan.manifestRef, contentHash: `sha256:${"3".repeat(64)}` } } },
      { plan: { ...outcome.plan, marketRefs: [] } },
    ];
    for (const override of others) {
      const other = aggregateEnvironment({ ...outcome, ...override, now: NOW });
      assert.notEqual(other.contentHash, first.contentHash, JSON.stringify(Object.keys(override)));
    }
  });
});

test("market refs are report metadata only: they never touch strata, weights, EV, confidence or coverage", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const withMarket = aggregateEnvironment({ ...outcome, now: NOW });
    const withoutMarket = aggregateEnvironment({
      ...outcome,
      plan: { ...outcome.plan, marketRefs: [] },
      now: NOW,
    });
    assert.ok(withMarket.metadata.marketRefs.length > 0);
    assert.deepEqual(withoutMarket.metadata.marketRefs, []);
    assert.deepEqual(withoutMarket.ev, withMarket.ev);
    assert.deepEqual(withoutMarket.confidence, withMarket.confidence);
    assert.deepEqual(withoutMarket.coverage, withMarket.coverage);
    assert.deepEqual(withoutMarket.strata, withMarket.strata);
    // Market evidence is not silently dropped either: it is echoed where it cannot be mistaken for
    // strength, and the hash still covers it.
    assert.notEqual(withoutMarket.contentHash, withMarket.contentHash);
    assert.equal(JSON.stringify(withMarket.strata).includes("market"), false);
    assert.equal(JSON.stringify(withMarket.ev).includes("market"), false);
  });
});

test("a diagnostic report is labelled, blocker-bearing, and withholds every official strength claim", () => {
  withRoot((roots) => {
    const report = aggregateEnvironment({ ...runPlan(diagnosticBundle, roots), now: NOW });
    assert.equal(report.evaluationMode, "diagnostic_estimate");
    assert.equal(report.officialStrengthClaim, false);
    assert.equal(report.strengthClaimWithheld, true);
    assert.ok(report.blockers.some((blocker) => blocker.code === "clock_model_unavailable"));
    assert.equal(report.roundTimeoutPolicy, null);
    assert.equal(report.clockRef, null);
  });
});

/* ------------------------------------------------------------------ *
 * 4. observed evidence
 * ------------------------------------------------------------------ */

test("observed and simulated evidence are never merged row-wise", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const error = failure(() => aggregateEnvironment({
      ...outcome,
      observed: [{ anything: true }],
      now: NOW,
    }));
    assert.equal(error.code, "matchup_provenance_invalid");
    assert.equal(error.details.reason, "observed_and_simulated_not_mergeable");
  });
});

test("an observed report uses pinned parametric binomial resampling and its own interval label", () => {
  const observed = observedSnapshotFor();
  const report = aggregateEnvironment({ plan: planFor(officialBundle), observed: [observed], now: NOW });
  assert.equal(report.method, "observed");
  assert.equal(report.confidence.label, "observedSampling95");
  assert.equal(report.confidence.resampling, "parametric_binomial");
  assert.equal(report.confidence.seed, 20260820);
  assert.equal(report.confidence.replicates, 10000);
  assert.equal(report.ev.play, expectedSeatEv("play", {
    [`${ACE}|play`]: 108 / 200, [`${ACE}|draw`]: 108 / 200,
    [`${TEACH}|play`]: 108 / 200, [`${TEACH}|draw`]: 108 / 200,
  }));
  // An observed report can never emit a paired tech-slot interval: there is no paired source design.
  assert.equal(report.confidence.paired, null);
  assert.equal(report.pairedIntervalAvailable, false);
});

test("incomplete observed evidence is calibration-only and is never scored", () => {
  const observed = observedSnapshotFor((draft) => {
    draft.data.cells = draft.data.cells.filter((cell) => cell.candidateSeat === "play");
  });
  const error = failure(() => aggregateEnvironment({
    plan: planFor(officialBundle),
    observed: [observed],
    now: NOW,
  }));
  assert.equal(error.code, "insufficient_matchup_coverage");
  assert.equal(error.details.reason, "observed_calibration_only");
  assert.ok(error.details.reasons.includes("seat_split_incomplete"));
});

/* ------------------------------------------------------------------ *
 * 5. variant comparison
 * ------------------------------------------------------------------ */

test("a paired variant comparison joins on (pairingKey, seed) and reports a paired interval", () => {
  withRoot((roots) => {
    const baseline = runPlan(pairedScenario.base, roots, { script: pairedScenario.runnerScript, arm: "base" });
    const variant = runPlan(pairedScenario.variant, roots, { script: pairedScenario.runnerScript, arm: "variant" });
    const comparison = compareVariants(baseline, variant, { now: NOW });

    assert.equal(comparison.baseline.contentHash.slice(0, 7), "sha256:");
    assert.notEqual(comparison.variant.planHash, comparison.baseline.planHash);
    assert.equal(comparison.paired.join, "pairingKey_and_seed");
    assert.equal(comparison.paired.pairs, 800);
    assert.equal(comparison.paired.label, "simulationMonteCarlo95");

    // The exact paired difference, hand-checkable from the fixture's own counts.
    const expected = comparison.variant.ev.play - comparison.baseline.ev.play;
    assert.equal(comparison.paired.play.mean, expected);
    assert.ok(comparison.paired.play.lo < comparison.paired.play.mean);
    assert.ok(comparison.paired.play.mean < comparison.paired.play.hi);
    assert.equal(comparison.paired.discordantPairs.play, 8 + 12);
  });
});

test("a paired comparison refuses a position-based or truncated join", () => {
  withRoot((roots) => {
    const baseline = runPlan(pairedScenario.base, roots, { script: pairedScenario.runnerScript, arm: "base" });
    const variant = runPlan(pairedScenario.variant, roots, { script: pairedScenario.runnerScript, arm: "variant" });

    // (a) shortest-array truncation: one arm is missing a seed.
    const truncated = structuredClone(variant);
    truncated.results[0].snapshot = {
      ...truncated.results[0].snapshot,
      data: {
        ...truncated.results[0].snapshot.data,
        games: truncated.results[0].snapshot.data.games.slice(0, -1),
      },
    };
    let error = failure(() => compareVariants(baseline, truncated, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.equal(error.details.reason, "unpaired_seed");

    // (b) a duplicated (pairingKey, seed).
    const duplicated = structuredClone(variant);
    const games = duplicated.results[0].snapshot.data.games;
    duplicated.results[0].snapshot = {
      ...duplicated.results[0].snapshot,
      data: { ...duplicated.results[0].snapshot.data, games: [...games.slice(0, -1), games[0]] },
    };
    error = failure(() => compareVariants(baseline, duplicated, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.equal(error.details.reason, "duplicate_pair_key");

    // (c) a genuinely different seed schedule cannot be joined by array position.
    const reseeded = runPlan(pairedScenario.variant, roots, {
      script: pairedScenario.runnerScript,
      arm: "variant",
    });
    const shifted = structuredClone(reseeded);
    shifted.results[0].snapshot = {
      ...shifted.results[0].snapshot,
      data: {
        ...shifted.results[0].snapshot.data,
        games: shifted.results[0].snapshot.data.games.map((game, index) => (
          index === 0 ? { ...game, seed: game.seed + 1_000_000 } : game
        )),
      },
    };
    error = failure(() => compareVariants(baseline, shifted, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.equal(error.details.reason, "unpaired_seed");

    // (c2) the OPPOSITE direction: an arm with an EXTRA game. The per-seed lookup below walks the
    // baseline's seeds, so only a size comparison can notice a variant that played MORE games --
    // without it the extra row would be silently dropped and the pair count would still look right.
    const superset = structuredClone(variant);
    const extra = { ...superset.results[0].snapshot.data.games[0], seed: 424242424 };
    superset.results[0].snapshot = {
      ...superset.results[0].snapshot,
      data: {
        ...superset.results[0].snapshot.data,
        games: [...superset.results[0].snapshot.data.games, extra],
      },
    };
    error = failure(() => compareVariants(baseline, superset, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.equal(error.details.reason, "unpaired_seed");

    // (d) reordering the rows changes nothing, which is what proves the join is by key.
    const reordered = structuredClone(variant);
    reordered.results[0].snapshot = {
      ...reordered.results[0].snapshot,
      data: {
        ...reordered.results[0].snapshot.data,
        games: [...reordered.results[0].snapshot.data.games].reverse(),
      },
    };
    const straight = compareVariants(baseline, variant, { now: NOW });
    const scrambled = compareVariants(baseline, reordered, { now: NOW });
    assert.deepEqual(scrambled.paired, straight.paired);
  });
});

test("a paired comparison requires an identical Manifest, field, representative set and seat strata", () => {
  withRoot((roots) => {
    const baseline = runPlan(pairedScenario.base, roots, { script: pairedScenario.runnerScript, arm: "base" });
    const foreign = runPlan(diagnosticBundle, roots);
    const error = failure(() => compareVariants(baseline, foreign, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.ok(["manifest_mismatch", "strata_mismatch"].includes(error.details.reason));
  });
});

test("comparing a variant against itself is refused: there is nothing to pair", () => {
  withRoot((roots) => {
    const baseline = runPlan(pairedScenario.base, roots, { script: pairedScenario.runnerScript, arm: "base" });
    const error = failure(() => compareVariants(baseline, baseline, { now: NOW }));
    assert.equal(error.code, "report_pairing_invalid");
    assert.equal(error.details.reason, "identical_candidate");
  });
});

/* ------------------------------------------------------------------ *
 * 6. cross-environment comparison
 * ------------------------------------------------------------------ */

test("cross-environment comparison keeps both environments separate and blends nothing", () => {
  withRoot((roots) => {
    const official = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    const diagnostic = aggregateEnvironment({ ...runPlan(diagnosticBundle, roots), now: NOW });
    const comparison = compareEnvironments(
      [{ label: "SC", report: official }, { label: "SC_DIAGNOSTIC", report: diagnostic }],
      { now: NOW },
    );
    assert.equal(comparison.environments.length, 2);
    assert.equal(comparison.environments[0].label, "SC");
    assert.equal(comparison.environments[0].manifestRef.manifestId, official.manifestRef.manifestId);
    assert.equal(comparison.environments[0].evaluationMode, "official");
    assert.equal(comparison.environments[1].evaluationMode, "diagnostic_estimate");
    assert.notEqual(
      comparison.environments[0].manifestRef.manifestId,
      comparison.environments[1].manifestRef.manifestId,
    );
    assert.equal(comparison.difference.label, "SC minus SC_DIAGNOSTIC");
    assert.equal(comparison.difference.play, official.ev.play - diagnostic.ev.play);
    assert.equal(comparison.difference.confidence, null);
    assert.equal(comparison.difference.denominator, null);

    const text = JSON.stringify(comparison);
    for (const forbidden of ["blended", "combined", "pooled", "ranking"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

test("an illegal candidate stays an explicit illegal_deck cell in a cross-environment comparison", () => {
  withRoot((roots) => {
    const official = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    const comparison = compareEnvironments(
      [
        { label: "SC", report: official },
        { label: "EN", failure: { code: "illegal_deck", details: { reason: "banned_card", gameplayId: "OP07-045" } } },
      ],
      { now: NOW },
    );
    assert.equal(comparison.environments[1].status, "illegal_deck");
    assert.equal(comparison.environments[1].report, null);
    assert.equal(comparison.environments[1].details.reason, "banned_card");
    // No difference can be stated against an environment that produced no report.
    assert.equal(comparison.difference, null);
  });
});

test("cross-environment comparison refuses one environment, or the same Manifest twice", () => {
  withRoot((roots) => {
    const official = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    assert.equal(
      failure(() => compareEnvironments([{ label: "SC", report: official }], { now: NOW })).details.reason,
      "single_environment",
    );
    assert.equal(
      failure(() => compareEnvironments(
        [{ label: "SC", report: official }, { label: "SC again", report: official }],
        { now: NOW },
      )).details.reason,
      "identical_manifest",
    );
  });
});

/* ------------------------------------------------------------------ *
 * helpers that build observed evidence from the same genuine decks
 * ------------------------------------------------------------------ */

const { finalizeSnapshot } = await import("./snapshot.mjs");

function observedSnapshotFor(mutate = () => {}) {
  const candidate = candidateDeckOf(officialBundle);
  const deckFor = (snapshotId) => officialBundle.deckSnapshots.find((deck) => deck.snapshotId === snapshotId);
  const cell = (opponent, seat) => ({
    candidateDeckSnapshotId: candidate.snapshotId,
    candidateContentHash: candidate.contentHash,
    candidateGameplayHash: candidate.data.gameplayHash,
    opponentDeckSnapshotId: opponent.snapshotId,
    opponentContentHash: opponent.contentHash,
    opponentGameplayHash: opponent.data.gameplayHash,
    candidateSeat: seat,
    wins: 108,
    losses: 90,
    scoredRoundTimeouts: 2,
    validGames: 200,
    sampleSize: 200,
    unfinished: 0,
    toolFailures: 0,
    roundTimeout: {
      clockModelRef: { ...officialBundle.resolved.clockRef },
      edition: "SC",
      metagameRegion: "CN",
      language: "zh-Hans",
      formatId: "standard-block2-op16",
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
    },
  });
  const draft = {
    schemaVersion: 1,
    kind: "matchup",
    environment: {
      edition: "SC",
      metagameRegion: "CN",
      language: "zh-Hans",
      formatId: "standard-block2-op16",
      timeZone: "Asia/Shanghai",
    },
    asOf: "2026-08-20",
    source: { provider: "fixture", surface: "matchup", sourceRef: { fixtureId: "observed-report" } },
    coverage: { status: "complete", warnings: [], missingFields: [] },
    data: {
      method: "observed",
      applicability: "native",
      population: "SC Swiss observed population (fixture)",
      window: { startLocalDate: "2026-07-01", asOf: "2026-08-20", timeZone: "Asia/Shanghai" },
      roundPolicy: { stage: "swiss", roundDurationMinutes: 30, timeoutScoring: "double-loss" },
      formatId: "standard-block2-op16",
      cells: officialBundle.resolved.strata.flatMap((row) => {
        const opponent = deckFor(row.representatives[0].deckRef.snapshotId);
        return [cell(opponent, "play"), cell(opponent, "draw")];
      }),
    },
  };
  mutate(draft);
  return finalizeSnapshot(draft, "matchup-sc-observed-report");
}

/* ------------------------------------------------------------------ *
 * fix round 1
 * ------------------------------------------------------------------ */

test("I1: a simulated cell is re-validated at aggregation, and every corrupt shape is refused", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const probe = (mutate) => {
      const corrupted = structuredClone(outcome);
      mutate(corrupted.results[0].cell);
      return failure(() => aggregateEnvironment({ ...corrupted, now: NOW }));
    };

    // (a) the exact reviewer probe: counts say 150/200, the declared rate still says 0.55. Before
    // this guard, EV read the rate while Wilson read the counts and the report disagreed with itself.
    let error = probe((cell) => { cell.wins = 150; cell.losses = 50; });
    assert.equal(error.code, "matchup_cell_invalid");
    assert.equal(error.details.reason, "win_rate_inconsistent");
    assert.equal(error.details.declared, 110 / 200);
    assert.equal(error.details.derived, 150 / 200);

    // (b) an unfinished row smuggled in at aggregation time invalidates the cell, exactly as it does
    // at publication time -- whether or not the sample size was adjusted to match.
    error = probe((cell) => { cell.unfinished = 7; cell.sampleSize = 207; });
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "cell_invalidated_by_unfinished_row");
    error = probe((cell) => { cell.unfinished = 7; });
    assert.equal(error.details.reason, "sample_size_inconsistent");

    // (c) a cell scored below the 200-game floor.
    error = probe((cell) => {
      cell.wins = 6;
      cell.losses = 4;
      cell.validGames = 10;
      cell.sampleSize = 10;
      cell.winRate = 0.6;
    });
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "below_per_seat_floor");

    // (d) more wins than games: caught by the arithmetic, not incidentally by the interval.
    error = probe((cell) => { cell.wins = 300; });
    assert.equal(error.code, "matchup_cell_invalid");
    assert.equal(error.details.reason, "outcome_counts_inconsistent");

    // (e) a result record with no published rows or provenance cannot be aggregated at all.
    const stripped = structuredClone(outcome);
    delete stripped.results[0].snapshot.data.games;
    error = failure(() => aggregateEnvironment({ ...stripped, now: NOW }));
    assert.equal(error.code, "report_input_invalid");
    assert.equal(error.details.reason, "result_record_incomplete");

    // The positive control: untouched, the same input still aggregates and EV is DERIVED from counts.
    const clean = aggregateEnvironment({ ...outcome, now: NOW });
    assert.equal(clean.strata[0].representatives[0].seats.play.winRate, 110 / 200);
  });
});

test("I1: the incidental interval failure now carries a stable reason", () => {
  assert.equal(failure(() => wilsonInterval(1, 0)).details.reason, "denominator_invalid");
  assert.equal(failure(() => wilsonInterval(3, 2)).details.reason, "successes_out_of_range");
});

test("I2: official strength is withheld until a round-timeout adjudicator has actually run", () => {
  withRoot((roots) => {
    // No adjudication at all: official MODE, but the claim is withheld and the report says why.
    const unadjudicated = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    assert.equal(unadjudicated.evaluationMode, "official");
    assert.equal(unadjudicated.officialStrengthClaim, false);
    assert.equal(unadjudicated.strengthClaimWithheld, true);
    assert.equal(unadjudicated.timeoutAdjudication.applied, false);
    assert.equal(unadjudicated.timeoutAdjudication.applicable, true);
    assert.equal(unadjudicated.timeoutAdjudication.source, null);
    assert.equal(unadjudicated.timeoutAdjudication.adjudicatedSeeds, 0);
    assert.equal(unadjudicated.timeoutAdjudication.scoredRoundTimeouts, 0);
    const blocker = unadjudicated.blockers.find((entry) => entry.code === "round_timeout_unadjudicated");
    assert.ok(blocker, "an unadjudicated official report must name the blocker");
    assert.equal(blocker.reason, "no_adjudicator_applied");
    assert.equal(blocker.clockModelRef.contentHash, officialBundle.resolved.clockRef.contentHash);
  });
});

test("I2: an adjudicator that ran and found ZERO timeouts is a measurement, and the claim stands", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [], evaluatedSeeds: job.seeds.length };
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    });
    const report = aggregateEnvironment({ ...outcome, now: NOW });
    assert.equal(report.officialStrengthClaim, true);
    assert.equal(report.strengthClaimWithheld, false);
    assert.equal(report.timeoutAdjudication.applied, true);
    assert.equal(report.timeoutAdjudication.adjudicatedCells, 4);
    assert.equal(report.timeoutAdjudication.adjudicatedSeeds, 0);
    assert.equal(report.timeoutAdjudication.scoredRoundTimeouts, 0);
    assert.equal(report.timeoutAdjudication.source.clockModelRef.contentHash, plan.clockRef.contentHash);
    assert.equal(report.blockers.some((entry) => entry.code === "round_timeout_unadjudicated"), false);
    // "measured zero" and "never measured" now produce DIFFERENT artifacts, which is the whole point.
    const never = aggregateEnvironment({ ...outcome, timeoutAdjudication: null, now: NOW });
    assert.notEqual(never.contentHash, report.contentHash);
    assert.equal(never.officialStrengthClaim, false);
  });
});

test("I2: a diagnostic environment states that adjudication is impossible, not merely absent", () => {
  withRoot((roots) => {
    const report = aggregateEnvironment({ ...runPlan(diagnosticBundle, roots), now: NOW });
    assert.equal(report.timeoutAdjudication.applied, false);
    assert.equal(report.timeoutAdjudication.applicable, true);
    // The clock blocker already explains it; no second blocker is stacked on a diagnostic report.
    assert.equal(report.blockers.filter((entry) => entry.code === "round_timeout_unadjudicated").length, 0);
    assert.equal(report.officialStrengthClaim, false);
  });
});

test("I2: an adjudication that covers only some cells is refused, not reported as applied", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs.slice(0, 2)) cells[job.pairingKey] = { timedOutSeeds: [] };
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "round_timeout_adjudication_incomplete");
  });
});

test("I2: an EMPTY adjudication still needs the accepted clock model", () => {
  withRoot((roots) => {
    const plan = planFor(diagnosticBundle);
    const cells = {};
    for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [] };
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...officialBundle.resolved.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "clock_model_hash");
  });
});

test("I3: the replicate count is MEASURED, not labelled — every RNG draw is counted", () => {
  withRoot((roots) => {
    const outcome = runPlan(officialBundle, roots);
    const report = aggregateEnvironment({ ...outcome, now: NOW });
    const totalValidGames = outcome.results.reduce((total, record) => total + record.cell.validGames, 0);
    assert.equal(totalValidGames, 800);
    // 10000 replicates x 800 games. A loop bound of REPLICATES - 1 leaves the published intervals
    // byte-identical (the discrete distribution ties adjacent order statistics) but cannot leave
    // this number alone.
    assert.equal(report.confidence.rngDraws, 8_000_000);
    assert.equal(report.confidence.rngDraws, report.confidence.replicates * totalValidGames);
    assert.equal(report.confidence.replicates, BOOTSTRAP_REPLICATES);
  });
});

test("I3: the paired resampler's draws are counted too", () => {
  withRoot((roots) => {
    const baseline = runPlan(pairedScenario.base, roots, { script: pairedScenario.runnerScript, arm: "base" });
    const variant = runPlan(pairedScenario.variant, roots, { script: pairedScenario.runnerScript, arm: "variant" });
    const comparison = compareVariants(baseline, variant, { now: NOW });
    assert.equal(comparison.paired.pairs, 800);
    assert.equal(comparison.paired.rngDraws, 8_000_000);
    assert.equal(comparison.paired.rngDraws, comparison.paired.replicates * comparison.paired.pairs);
  });
});

test("minor: the report pins that market evidence was not used for strength", () => {
  withRoot((roots) => {
    const report = aggregateEnvironment({ ...runPlan(officialBundle, roots), now: NOW });
    assert.equal(report.metadata.marketEvidenceUsedForStrength, false);
    assert.ok(report.metadata.marketRefs.length > 0);
  });
});

/* ------------------------------------------------------------------ *
 * I4 — the multi-representative path, end to end
 * ------------------------------------------------------------------ */

const multiScenario = pairedScenario.multiRepresentative;

test("I4: the within-archetype tolerance holds at 1e-13 and fails at 1e-11", () => {
  const strata = multiScenario.base.resolved.strata;
  const ace = strata.find((row) => row.archetypeId === ACE);
  assert.equal(ace.representatives.length, 2, "the fixture must have TWO representatives");
  assert.deepEqual(ace.representatives.map((row) => row.withinArchetypeWeight), [0.6, 0.4]);
  assert.ok(assertExactCoverage(strata));

  // Inside the tolerance: a rounding-scale perturbation of a within-level weight is accepted.
  for (const delta of [1e-13, -1e-13]) {
    const nudged = structuredClone(strata);
    nudged[0].representatives[0].withinArchetypeWeight += delta;
    assert.ok(assertExactCoverage(nudged), `within-level ${delta} must pass`);
  }
  // Outside it: refused, at a magnitude a loosened tolerance would wave through. The previous only
  // within-level negative case was a gross 0.5 violation, which any tolerance up to 0.5 still caught.
  for (const delta of [1e-11, -1e-11]) {
    const broken = structuredClone(strata);
    broken[0].representatives[0].withinArchetypeWeight += delta;
    const error = failure(() => assertExactCoverage(broken));
    assert.equal(error.code, "field_not_representative", `within-level ${delta} must fail`);
    assert.equal(error.details.reason, "representative_weights_unreconciled");
    assert.equal(error.details.archetypeId, ACE);
    assert.ok(Math.abs(error.details.sum - 1) > 1e-12);
  }
  // The same boundary at the FIELD level, so neither tolerance can be loosened unobserved.
  for (const delta of [1e-13, -1e-13]) {
    const nudged = structuredClone(strata);
    nudged[0].fieldWeight += delta;
    assert.ok(assertExactCoverage(nudged), `field-level ${delta} must pass`);
  }
  for (const delta of [1e-11, -1e-11]) {
    const broken = structuredClone(strata);
    broken[0].fieldWeight += delta;
    assert.equal(failure(() => assertExactCoverage(broken)).details.reason, "field_weights_unreconciled");
  }
});

test("I4: a multi-representative archetype expands to four jobs and weights EV nested", () => {
  withRoot((roots) => {
    const outcome = runPlan(multiScenario.base, roots, { script: multiScenario.runnerScript, arm: "base" });
    assert.equal(outcome.plan.jobs.length, 6);
    assert.equal(outcome.plan.jobs.filter((job) => job.archetypeId === ACE).length, 4);
    assert.equal(outcome.plan.jobs.filter((job) => job.archetypeId === TEACH).length, 2);
    // Two representatives of one archetype get DIFFERENT seed schedules, or their games would be
    // correlated and the within-archetype split would be measuring one deck twice.
    const acePlaySchedules = outcome.plan.jobs
      .filter((job) => job.archetypeId === ACE && job.seat === "play")
      .map((job) => job.seeds.join(","));
    assert.equal(new Set(acePlaySchedules).size, 2);

    const report = aggregateEnvironment({ ...outcome, now: NOW });
    assert.equal(report.coverage.cells, 6);
    assert.equal(report.coverage.requiredCells, 6);
    const aceRow = report.strata.find((row) => row.archetypeId === ACE);
    assert.equal(aceRow.representatives.length, 2);
    assert.deepEqual(aceRow.representatives.map((row) => row.withinArchetypeWeight), [0.6, 0.4]);
    assert.equal(aceRow.representatives[0].seats.play.wins, 110);
    assert.equal(aceRow.representatives[1].seats.play.wins, 130);

    // The nested weighting, written out independently: the two representatives must be combined by
    // their within-archetype weights BEFORE the field share is applied.
    const field = { ace: aceRow.fieldWeight, teach: report.strata.find((row) => row.archetypeId === TEACH).fieldWeight };
    const expectedPlay = field.ace * (0.6 * (110 / 200) + 0.4 * (130 / 200)) + field.teach * (120 / 200);
    const expectedDraw = field.ace * (0.6 * (96 / 200) + 0.4 * (106 / 200)) + field.teach * (88 / 200);
    assert.equal(report.ev.play, expectedPlay);
    assert.equal(report.ev.draw, expectedDraw);
    assert.equal(report.ev.overall, 0.5 * expectedPlay + 0.5 * expectedDraw);
    // ...and the two representatives are NOT interchangeable: swapping the weights moves the answer,
    // so the 0.6/0.4 split is genuinely observable in this fixture.
    const swapped = field.ace * (0.4 * (110 / 200) + 0.6 * (130 / 200)) + field.teach * (120 / 200);
    assert.notEqual(swapped, expectedPlay);

    // The bootstrap template and its draw count both scale with the extra representative.
    assert.equal(report.confidence.rngDraws, 10000 * 1200);
    assert.ok(report.confidence.play.lo <= report.ev.play && report.ev.play <= report.confidence.play.hi);
  });
});

test("I4: the paired join runs over a multi-representative field", () => {
  withRoot((roots) => {
    const baseline = runPlan(multiScenario.base, roots, { script: multiScenario.runnerScript, arm: "base" });
    const variant = runPlan(multiScenario.variant, roots, { script: multiScenario.runnerScript, arm: "variant" });
    const comparison = compareVariants(baseline, variant, { now: NOW });
    assert.equal(comparison.paired.join, "pairingKey_and_seed");
    assert.equal(comparison.paired.pairs, 1200);
    assert.equal(comparison.paired.rngDraws, 10000 * 1200);
    // |110-118| + |130-124| + |120-132| on play; |96-96| + |106-110| + |88-90| on draw.
    assert.equal(comparison.paired.discordantPairs.play, 8 + 6 + 12);
    assert.equal(comparison.paired.discordantPairs.draw, 0 + 4 + 2);
    assert.equal(comparison.paired.play.mean, comparison.variant.ev.play - comparison.baseline.ev.play);
    assert.ok(comparison.paired.play.lo < comparison.paired.play.hi);
    // Both arms share the Manifest and every representative, and differ only in the candidate.
    assert.equal(comparison.baseline.manifestRef.manifestId, comparison.variant.manifestRef.manifestId);
    assert.notEqual(comparison.baseline.candidate.gameplayHash, comparison.variant.candidate.gameplayHash);
    assert.notEqual(comparison.baseline.planHash, comparison.variant.planHash);
  });
});

/* ------------------------------------------------------------------ *
 * N1 (fix round 2) — a directly-supplied adjudication block is authenticated
 * ------------------------------------------------------------------ */

/** A real executed outcome whose adjudication ran over every cell and found nothing. */
function adjudicatedOutcome(roots) {
  const plan = planFor(officialBundle);
  const cells = {};
  for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [], evaluatedSeeds: job.seeds.length };
  const outcome = executeSimulationPlan(plan, {
    runner: createFakeRunner(defaultScript),
    cacheRoot: roots.cacheRoot,
    resultsRoot: roots.resultsRoot,
    now: NOW,
    timeoutAdjudication: {
      clockModelRef: { ...plan.clockRef },
      edition: "SC",
      metagameRegion: "CN",
      language: "zh-Hans",
      formatId: "standard-block2-op16",
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
      cells,
    },
  });
  return { plan, outcome, genuine: outcome.timeoutAdjudication };
}

test("N1: a forged adjudication block cannot buy an official strength claim", () => {
  withRoot((roots) => {
    const { outcome } = adjudicatedOutcome(roots);

    // The reviewer's exact probe: claims to have run, names a clock model that is not this
    // environment's, and asserts a cell count that is not this report's.
    const error = failure(() => aggregateEnvironment({
      ...outcome,
      timeoutAdjudication: {
        applied: true,
        source: { clockModelRef: { contentHash: "sha256:deadbeef" } },
        adjudicatedCells: 999,
        adjudicatedSeeds: 0,
      },
      now: NOW,
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "clock_model_hash");
    // ...and it fails CLOSED: no report is produced at all, so there is no claim to inspect.
    assert.equal(error.details.expected, officialBundle.resolved.clockRef.contentHash);
  });
});

test("N1: every field of a claimed adjudication is cross-checked, one guard at a time", () => {
  withRoot((roots) => {
    const { plan, outcome, genuine } = adjudicatedOutcome(roots);
    const probe = (timeoutAdjudication) => failure(() => aggregateEnvironment({
      ...outcome,
      timeoutAdjudication,
      now: NOW,
    }));

    // The genuine block is the control: it must still produce an unqualified official claim, or the
    // guards below would be measuring nothing.
    const honest = aggregateEnvironment({ ...outcome, now: NOW });
    assert.equal(honest.officialStrengthClaim, true);
    assert.equal(honest.timeoutAdjudication.applied, true);
    assert.equal(genuine.adjudicatedCells, 4);
    assert.equal(genuine.adjudicatedSeeds, 0);

    // (a) the right model, the wrong tournament: each of the seven dimensions individually.
    for (const [key, value] of Object.entries({
      edition: "EN",
      metagameRegion: "GLOBAL_EN",
      language: "en",
      formatId: "standard-block2-op17",
      stage: "top-cut",
      roundDurationMinutes: 45,
      timeoutScoring: "extra-turns",
    })) {
      const error = probe({ ...genuine, source: { ...genuine.source, [key]: value } });
      assert.equal(error.code, "simulation_result_mismatch", key);
      assert.equal(error.details.reason, "clock_model_mismatch", key);
      assert.deepEqual(error.details.mismatches, [key]);
    }

    // (b) a clock model this environment never accepted, by id as well as by hash.
    for (const ref of [
      { ...genuine.source.clockModelRef, contentHash: `sha256:${"e".repeat(64)}` },
      { ...genuine.source.clockModelRef, snapshotId: "clock-model-sc-swiss-0000000000000000" },
    ]) {
      const error = probe({ ...genuine, source: { ...genuine.source, clockModelRef: ref } });
      assert.equal(error.details.reason, "clock_model_hash");
    }

    // (c) a cell count that is not the count this report aggregated.
    for (const declared of [999, 3, 0]) {
      const error = probe({ ...genuine, adjudicatedCells: declared });
      assert.equal(error.code, "report_input_invalid");
      assert.equal(error.details.reason, "adjudication_cell_count_mismatch");
      assert.equal(error.details.declared, declared);
      assert.equal(error.details.aggregated, 4);
    }

    // (d) a seed count that disagrees with the timeouts the cells actually scored.
    const error = probe({ ...genuine, adjudicatedSeeds: 5 });
    assert.equal(error.code, "report_input_invalid");
    assert.equal(error.details.reason, "adjudication_seed_count_mismatch");
    assert.equal(error.details.declared, 5);
    assert.equal(error.details.scoredRoundTimeouts, 0);

    // (e) claiming to have run while naming no model at all.
    assert.equal(
      probe({ applied: true, source: null, adjudicatedCells: 4, adjudicatedSeeds: 0 }).details.reason,
      "adjudication_source_missing",
    );

    // (f) naming a model while not claiming to have run: contradictory, not a half-measure.
    assert.equal(
      probe({ ...genuine, applied: false }).details.reason,
      "adjudication_summary_inconsistent",
    );

    // (g) a shape that is not the contract at all.
    assert.equal(probe({ ...genuine, extra: 1 }).details.reason, "adjudication_summary_invalid");
    assert.equal(probe("applied").details.reason, "adjudication_summary_invalid");
    assert.equal(probe(7).details.reason, "adjudication_summary_invalid");

    // (h) an adjudication claimed for an environment that holds no accepted clock at all.
    const diagnostic = runPlan(diagnosticBundle, roots);
    const diagnosticError = failure(() => aggregateEnvironment({
      ...diagnostic,
      timeoutAdjudication: genuine,
      now: NOW,
    }));
    assert.equal(diagnosticError.code, "simulation_result_mismatch");
    assert.equal(diagnosticError.details.reason, "clock_model_hash");
    assert.ok(plan.clockRef);
  });
});

test("N1: an authenticated adjudication that scored real timeouts still reconciles", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs) {
      const key = `${job.archetypeId}|${job.seat}`;
      const indexes = timeoutScenario.timeoutAdjudication.cells[key]?.timedOutSeedIndexes ?? [];
      cells[job.pairingKey] = {
        timedOutSeeds: indexes.map((index) => job.seeds[index]),
        evaluatedSeeds: job.seeds.length,
      };
    }
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(timeoutScenario.runnerScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    });
    const report = aggregateEnvironment({ ...outcome, now: NOW });
    // Six adjudicated seeds (five on Ace/play, one on Ace/draw) and six scored round timeouts: the
    // declared total and the measured total are the same number, which is why they are checkable.
    assert.equal(report.timeoutAdjudication.applied, true);
    assert.equal(report.timeoutAdjudication.adjudicatedSeeds, 6);
    assert.equal(report.timeoutAdjudication.scoredRoundTimeouts, 6);
    assert.equal(report.officialStrengthClaim, true);
    // Understating the seeds by one is refused even though every other field is genuine.
    const error = failure(() => aggregateEnvironment({
      ...outcome,
      timeoutAdjudication: { ...outcome.timeoutAdjudication, adjudicatedSeeds: 5 },
      now: NOW,
    }));
    assert.equal(error.details.reason, "adjudication_seed_count_mismatch");
  });
});

/* ------------------------------------------------------------------ *
 * I-4 (final fix wave) — an adjudication that adjudicated NOTHING must
 * not satisfy the last gate
 * ------------------------------------------------------------------ */

test("I-4: the reviewer's exact reproduction — an empty adjudication cannot mint an official claim", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    // Every cell present, every cell EMPTY. Nothing is forged; nothing is supplied either. Before
    // this guard, `applied: timeoutAdjudication !== null` was a presence flag and this yielded
    // officialStrengthClaim: true with blockers: [] and adjudicatedSeeds: 0.
    const cells = {};
    for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [] };
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    }));
    assert.equal(error.code, "simulation_plan_invalid");
    assert.equal(error.details.reason, "round_timeout_adjudication_unevaluated");
  });
});

test("I-4: an adjudication must have EVALUATED every completed game it claims to cover", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const build = (evaluatedSeeds) => {
      const cells = {};
      for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [], evaluatedSeeds };
      return {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      };
    };
    // Each job plays 200 games. A cell that claims to have looked at 199 of them, or at 0, or at
    // more than were played, is a partial measurement wearing a complete label.
    for (const claimed of [0, 199, 201]) {
      const error = failure(() => executeSimulationPlan(plan, {
        runner: createFakeRunner(defaultScript),
        cacheRoot: roots.cacheRoot,
        resultsRoot: roots.resultsRoot,
        now: NOW,
        timeoutAdjudication: build(claimed),
      }));
      assert.equal(error.code, "simulation_result_mismatch", String(claimed));
      assert.equal(error.details.reason, "round_timeout_evaluated_seed_count_mismatch", String(claimed));
      assert.equal(error.details.declared, claimed);
      assert.equal(error.details.completedGames, 200);
    }
    // A non-integer count is refused on shape before anything is played.
    for (const claimed of [null, "200", 200.5, -1]) {
      const error = failure(() => executeSimulationPlan(plan, {
        runner: createFakeRunner(defaultScript),
        cacheRoot: roots.cacheRoot,
        resultsRoot: roots.resultsRoot,
        now: NOW,
        timeoutAdjudication: build(claimed),
      }));
      assert.equal(error.code, "simulation_plan_invalid", JSON.stringify(claimed));
      assert.equal(error.details.reason, "round_timeout_adjudication_unevaluated", JSON.stringify(claimed));
    }
  });
});

test("I-4: an adjudication that genuinely evaluated every game and found none still yields the claim", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [], evaluatedSeeds: 200 };
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    });
    assert.equal(outcome.timeoutAdjudication.applied, true);
    assert.equal(outcome.timeoutAdjudication.evaluatedSeeds, 800);
    assert.equal(outcome.timeoutAdjudication.adjudicatedSeeds, 0);

    const report = aggregateEnvironment({ ...outcome, now: NOW });
    assert.equal(report.officialStrengthClaim, true);
    assert.equal(report.strengthClaimWithheld, false);
    assert.equal(report.timeoutAdjudication.evaluatedSeeds, 800);
    assert.equal(report.blockers.some((entry) => entry.code === "round_timeout_unadjudicated"), false);
  });
});

test("I-4: aggregateEnvironment validates evaluatedSeeds the way it validates adjudicatedCells", () => {
  withRoot((roots) => {
    const plan = planFor(officialBundle);
    const cells = {};
    for (const job of plan.jobs) cells[job.pairingKey] = { timedOutSeeds: [], evaluatedSeeds: 200 };
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot: roots.cacheRoot,
      resultsRoot: roots.resultsRoot,
      now: NOW,
      timeoutAdjudication: {
        clockModelRef: { ...plan.clockRef },
        edition: "SC",
        metagameRegion: "CN",
        language: "zh-Hans",
        formatId: "standard-block2-op16",
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        cells,
      },
    });
    const genuine = outcome.timeoutAdjudication;
    const probe = (timeoutAdjudication) => failure(() => aggregateEnvironment({
      ...outcome,
      timeoutAdjudication,
      now: NOW,
    }));

    // A block re-read from a persisted artifact that claims to have run but names no evaluated
    // total at all: the exact shape the pre-fix orchestrator produced.
    const { evaluatedSeeds, ...withoutTotal } = genuine;
    assert.equal(evaluatedSeeds, 800);
    assert.equal(probe(withoutTotal).details.reason, "adjudication_evaluated_seeds_missing");

    for (const declared of [0, 799, 801]) {
      const error = probe({ ...genuine, evaluatedSeeds: declared });
      assert.equal(error.code, "report_input_invalid", String(declared));
      assert.equal(error.details.reason, "adjudication_evaluated_seed_count_mismatch", String(declared));
      assert.equal(error.details.declared, declared);
      assert.equal(error.details.completedGames, 800);
    }
  });
});
