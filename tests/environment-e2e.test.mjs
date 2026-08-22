// Offline, no-Android end-to-end acceptance for the multi-environment pipeline (Task 12).
//
// It runs the whole chain with nothing mocked except the two seams that must be injected:
//
//   raw synthetic SC capture bytes
//     -> tools/jihuanshe_normalize.mjs           (real normalizer)
//     -> environment/field.mjs                   (real aggregation)     -> SC FieldSnapshot
//     -> environment/manifest.mjs                (real identity + refs) -> SC Manifest
//     -> environment/resolver.mjs                (real fail-closed resolve)
//     -> environment/simulation.mjs              (real plan + execution, FAKE runner)
//     -> environment/report.mjs                  (real weighting + bootstrap)
//   synthetic EN event fixture -> the same chain from FieldSnapshot onward -> EN Manifest
//   both reports -> compareEnvironments -> one side-by-side comparison, no blended number
//
// WHAT THE NEGATIVE ASSERTIONS ARE FOR. This file's whole reason to exist is that the SC data path
// normally begins on an owner-authenticated Android emulator. An automated test must never touch
// that, and "we didn't mean to" is not a guarantee. So the acquisition boundary is enforced two
// independent ways:
//
//   1. STATICALLY -- the transitive import graph of every module this test uses is walked from
//      source, and no file in it may be, or import, an acquisition module (jihuanshe_capture,
//      jihuanshe_lifecycle, jihuanshe_reader, jihuanshe_refresh) or name ADB / an emulator /
//      Android. The single file allowed to import `node:child_process` is named exactly.
//   2. DYNAMICALLY -- a `module.registerHooks` loader is installed BEFORE any pipeline module is
//      imported. It (a) throws on any attempt to resolve an acquisition specifier from anywhere in
//      the graph, and (b) substitutes a POISONED `node:child_process` for every repository module,
//      so any attempt to start any child process throws. The poison is proved live by calling the
//      one real spawn site in the pipeline and watching it throw.
//
// Every pipeline module is therefore imported DYNAMICALLY, after the hooks are registered -- a
// static `import` at the top of this file would be resolved before the hooks existed and would
// silently escape both checks.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import module from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_URL = new URL("../", import.meta.url);
const REPO_ROOT = fileURLToPath(REPO_URL);
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "environment");
const SC_FIXTURES = join(FIXTURES, "end-to-end-sc");
const EN_FIXTURES = join(FIXTURES, "end-to-end-en");

/* ================================================================== *
 * 1. The acquisition boundary, installed before anything is imported
 * ================================================================== */

// Any specifier matching one of these must never be resolved from anywhere in the graph.
const FORBIDDEN_SPECIFIERS = Object.freeze([
  /jihuanshe_capture/i,
  /jihuanshe_lifecycle/i,
  /jihuanshe_reader/i,
  /jihuanshe_refresh/i,
  /(^|[^a-z])adb([^a-z]|$)/i,
  /emulator/i,
  /android/i,
  /uiautomator/i,
  /appium/i,
]);
const CHILD_PROCESS_SPECIFIERS = new Set(["child_process", "node:child_process"]);

const POISON_SOURCE = `// Written at run time by tests/environment-e2e.test.mjs. Substituted for
// node:child_process for every repository module, so that ANY attempt to start a
// process during the offline end-to-end run throws instead of running.
function poisoned(name) {
  return function forbidden() {
    const error = new Error(\`CHILD_PROCESS_FORBIDDEN: \${name} is not available in the offline end-to-end run\`);
    error.code = "CHILD_PROCESS_FORBIDDEN";
    throw error;
  };
}
export const spawn = poisoned("spawn");
export const spawnSync = poisoned("spawnSync");
export const exec = poisoned("exec");
export const execSync = poisoned("execSync");
export const execFile = poisoned("execFile");
export const execFileSync = poisoned("execFileSync");
export const fork = poisoned("fork");
export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork };
`;

const HOOK_ROOT = mkdtempSync(join(tmpdir(), "environment-e2e-hooks-"));
const POISON_PATH = join(HOOK_ROOT, "child-process-poison.mjs");
writeFileSync(POISON_PATH, POISON_SOURCE, { mode: 0o600 });
const POISON_URL = pathToFileURL(POISON_PATH).href;

/** Every forbidden specifier the loader refused, and every module handed the poison. */
const refusedSpecifiers = [];
const poisonedImporters = new Set();

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const pattern of FORBIDDEN_SPECIFIERS) {
      if (pattern.test(specifier)) {
        refusedSpecifiers.push(specifier);
        const error = new Error(`FORBIDDEN_IMPORT: ${specifier}`);
        error.code = "FORBIDDEN_IMPORT";
        throw error;
      }
    }
    // Only repository modules are given the poison. Substituting it for node's own internals
    // would break the test runner rather than test anything.
    const parent = typeof context?.parentURL === "string" ? context.parentURL : "";
    if (CHILD_PROCESS_SPECIFIERS.has(specifier) && parent.startsWith(REPO_URL.href)) {
      poisonedImporters.add(parent);
      return { url: POISON_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/* ================================================================== *
 * 2. The pipeline, imported only now
 * ================================================================== */

const { derivedArtifactPath } = await import("../environment/alias.mjs");
const {
  EnvironmentError,
  buildBanlistSnapshot,
  buildCapabilitySnapshot,
  buildCardPoolSnapshot,
  buildClockSnapshot,
  buildConstructionSnapshot,
  buildDeckSnapshot,
  buildFieldSnapshot,
  buildManifest,
  buildRulesSnapshot,
  compareEnvironments,
  createSimulateShRunner,
  executeSimulationPlan,
  expandSimulationPlan,
  finalizeSnapshot,
  aggregateEnvironment,
  environmentKey,
  publishImmutableArtifact,
  publishManifest,
  resolveEnvironment,
  sha256Canonical,
  snapshotRef,
} = await import("../environment/index.mjs");
const { normalizeJiHuanSheCapture } = await import("../tools/jihuanshe_normalize.mjs");
const { createFakeRunner } = await import("./fixtures/environment/fake-simulation-runner.mjs");

/* ================================================================== *
 * 3. Deterministic synthetic inputs
 * ================================================================== */

const ASOF = "2026-08-20";
const WINDOW_START = "2026-07-22";
const NOW = "2026-08-21T09:00:00+08:00";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const CANDIDATE_LEADER = "OP16-001";
const OPPONENT_LEADER = "OP16-080";

const SC = Object.freeze({
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
});
const EN = Object.freeze({
  edition: "EN",
  metagameRegion: "GLOBAL_EN",
  language: "en",
  formatId: "standard-block2-op16",
  timeZone: "America/Los_Angeles",
});

const SOURCE = Object.freeze({
  provider: "fixture",
  surface: "environment",
  sourceRef: { fixtureId: "task-12-offline-e2e" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: HASH_A,
});

const SETTINGS = Object.freeze({
  strategyCandidate: "valueRanked",
  strategyOpponent: "valueRanked",
  engineRevision: "engine-commit-fixture",
  maxCommands: 800,
  maxTurns: 40,
  comparisonSeed: 20260820,
});

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const poolInput = json(join(FIXTURES, "card-pool-sc-op16.json"));
const banlistInput = json(join(FIXTURES, "banlist-sc-op16.json"));
const constructionInput = json(join(FIXTURES, "construction-standard.json"));
const deckInput = json(join(FIXTURES, "deck-ace-op16.json"));
const scMapping = json(join(SC_FIXTURES, "mappings.json"));
const scOutcomeScript = json(join(SC_FIXTURES, "outcome-script.json"));
const enOutcomeScript = json(join(EN_FIXTURES, "outcome-script.json"));
const enEventFixture = json(join(EN_FIXTURES, "synthetic-event.json"));

// Hand-computed from the shared outcome script and each field's own weights. See
// tests/fixtures/environment/end-to-end-*/outcome-script.json for the per-cell counts.
//   SC weights 0.375 Ace / 0.625 Teach ; EN weights 0.625 Ace / 0.375 Teach
//   play  win rates: Ace 100/200 = 0.50 ; Teach 120/200 = 0.60
//   draw  win rates: Ace  90/200 = 0.45 ; Teach 110/200 = 0.55
const EXPECTED = Object.freeze({
  SC: { weights: { Ace: 0.375, Teach: 0.625 }, play: 0.5625, draw: 0.5125, overall: 0.5375 },
  EN: { weights: { Ace: 0.625, Teach: 0.375 }, play: 0.5375, draw: 0.4875, overall: 0.5125 },
});

/* ================================================================== *
 * 4. Builders -- every artifact through its real builder
 * ================================================================== */

function catalogRows() {
  return [...poolInput.cards.map((card) => card.gameplayId), OPPONENT_LEADER]
    .sort()
    .map((gameplayId) => ({
      printingId: gameplayId,
      gameplayId,
      effectText: null,
      triggerText: null,
      hasStructuredEffects: true,
    }));
}

/** The SC field, built from the raw capture bytes through the real normalizer. */
function scFieldFromRawCapture() {
  const bytes = readFileSync(join(SC_FIXTURES, "raw-tournament-capture.json"));
  const context = {
    environment: { ...SC },
    formatId: SC.formatId,
    timeZone: SC.timeZone,
    asOf: ASOF,
    parserVersion: "task-12-e2e-normalizer-v1",
    mapping: scMapping,
  };
  const [event] = normalizeJiHuanSheCapture(bytes, context);
  const field = buildFieldSnapshot({
    events: [event],
    identity: { ...SC },
    window: { startLocalDate: WINDOW_START, asOf: ASOF, timeZone: SC.timeZone },
    sourceRefs: [snapshotRef(event)],
    selectionPolicy: { id: "task-12-e2e-selection-v1" },
  });
  return { event, field };
}

/** The EN field, built from the synthetic event fixture. Deliberately NOT a JiHuanShe capture. */
function enFieldFromSyntheticEvent() {
  // `fixture_only` marks the FILE, not the snapshot: it is stripped before finalization so no
  // non-contract field can ever reach a published artifact.
  const { fixture_only: marker, ...body } = enEventFixture;
  assert.equal(marker, true, "the EN event fixture must declare itself fixture-only");
  const event = finalizeSnapshot(body, "task-12-e2e-en-event");
  const field = buildFieldSnapshot({
    events: [event],
    identity: { ...EN },
    window: { startLocalDate: WINDOW_START, asOf: ASOF, timeZone: EN.timeZone },
    sourceRefs: [snapshotRef(event)],
    selectionPolicy: { id: "task-12-e2e-selection-v1" },
  });
  return { event, field };
}

function marketFromRawCapture(arm) {
  const bytes = readFileSync(join(SC_FIXTURES, `raw-market-capture-${arm}.json`));
  const [market] = normalizeJiHuanSheCapture(bytes, {
    environment: { ...SC },
    formatId: SC.formatId,
    timeZone: SC.timeZone,
    asOf: ASOF,
    parserVersion: "task-12-e2e-normalizer-v1",
    mapping: scMapping,
  });
  return market;
}

/**
 * Every non-field artifact one environment needs, plus a clock model in one of three states.
 *
 * WHY BOTH `"absent"` AND `"expired"` ARE EXERCISED, AND WHY NEITHER REPLACES THE OTHER. They are
 * DIFFERENT GATES with different blocker reasons: `"absent"` means the Manifest configured no clock
 * model at all (`clockModelRef: null` -> reason `clock_model_absent`), while `"expired"` means a
 * real, accepted clock model exists whose effective interval has closed, so the gate evaluates and
 * rejects it (reason `clock_gate_closed`). A test that covered only one would leave the other
 * unmeasured, so both have an arm and the arms assert their reasons differ.
 *
 * HISTORY, because the absent path is a regression site. `unavailable("clock_model_absent")` used to
 * pass no `cause` while its three siblings all did, so the resolver pushed
 * `{ code, reason, cause: undefined }`, `aggregateEnvironment` spread it into the payload it hashes,
 * and canonical hashing correctly rejected `undefined` -- meaning a Manifest with a null
 * `clockModelRef` resolved and then produced NO REPORT AT ALL (`canonical_unsupported_value`). Fixed
 * in fix round 1 by supplying `"clock_model_ref_null"`. The arm below is that fix's regression test:
 * it asserts a report is actually produced AND that the blocker carries a defined cause.
 */
function buildSupportingArtifacts(identity, { clock: clockMode }) {
  const rules = buildRulesSnapshot({
    ...identity,
    asOf: ASOF,
    source: SOURCE,
    authority: {
      name: "Bandai official rules",
      authorityId: `bandai-${identity.edition.toLowerCase()}`,
    },
    documentRefs: [
      { documentId: "comprehensive-rules", version: "1.2.0", sourceHash: HASH_B },
      { documentId: "tournament-rules", version: "1.6.0", sourceHash: HASH_A },
    ],
    effectiveFrom: "2026-04-01",
    effectiveUntil: null,
    sourceHashes: [HASH_B, HASH_A],
  });
  const cardPool = buildCardPoolSnapshot({
    ...poolInput,
    ...identity,
    asOf: ASOF,
    source: SOURCE,
    cards: [
      ...poolInput.cards,
      {
        gameplayId: OPPONENT_LEADER,
        isLeader: true,
        colors: ["Black"],
        releasedAt: "2026-04-01",
        legalFrom: "2026-04-01",
        legalUntil: null,
        releaseEvidenceRef: "sc-op16-release",
      },
    ].map((card) => ({ ...card, rulesIdentityHash: rules.data.rulesIdentityHash })),
  });
  const banlist = buildBanlistSnapshot({ ...banlistInput, ...identity, asOf: ASOF, source: SOURCE });
  const construction = buildConstructionSnapshot({
    ...constructionInput,
    ...identity,
    asOf: ASOF,
    source: SOURCE,
  });
  const rows = catalogRows();
  const capability = buildCapabilitySnapshot({
    ...identity,
    asOf: ASOF,
    source: { adapter: "task-12-e2e-capability" },
    engineRevision: SETTINGS.engineRevision,
    engineWorktreeHash: HASH_A,
    patchDefinitionHash: HASH_B,
    policySourceHash: HASH_A,
    catalogContentHash: sha256Canonical(rows),
    catalogRows: rows,
    patchCheck: { status: "passed", command: "patch_engine.py --check" },
    limitations: {
      schemaVersion: 1,
      definitionId: "task-12-e2e-limitations-v1",
      limitations: [
        {
          code: "attack-target-selection",
          evidenceLocation: "docs/simulation.md",
          affectedCapability: "battle",
          status: "closed",
          blocksOfficialStrength: true,
        },
      ],
    },
  });
  const rulesRef = snapshotRef(rules);
  const clock = clockMode === "absent"
    ? null
    : buildClockSnapshot({
      ...identity,
      asOf: ASOF,
      source: { adapter: "task-12-e2e-clock" },
      rulesSnapshotRef: rulesRef,
      tournamentStage: "swiss",
      roundDurationMinutes: 30,
      inputFeatures: [{ name: "turnCount", type: "integer", source: "simulation.turn_end" }],
      simulationEvents: [{ name: "turn_end", fields: ["turnNumber", "elapsedMs"] }],
      calibrationDatasets: [{
        datasetId: "task-12-e2e-clock-calibration",
        contentHash: HASH_B,
        population: "synthetic fixture sample",
        dateFrom: "2026-01-01",
        dateUntil: "2026-01-31",
        elapsedTimeLabels: ["elapsed_ms"],
      }],
      algorithm: {
        version: "clock-logistic-v1",
        parameters: { intercept: -1.2, turnCount: 0.08 },
        classificationThreshold: 0.5,
        deterministicInference: "sorted feature names; IEEE-754 float64; no random seed",
      },
      heldOutMetrics: { sampleCount: 1000, brierScore: 0.12, calibrationError: 0.03 },
      acceptancePolicy: { required: true, maxBrierScore: 0.2, maxCalibrationError: 0.1 },
      acceptance: "accepted",
      effectiveFrom: "2026-01-01",
      // An expired interval closes the clock gate; an open one authorizes it.
      effectiveUntil: clockMode === "expired" ? "2026-01-31" : null,
      roundTimeoutPolicy: {
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        rulesSnapshotRef: rulesRef,
      },
    });
  return { identity, rules, cardPool, banlist, construction, capability, clock };
}

// Decks are edition-neutral by contract, so ONE pair serves both environments: the comparison is
// then unambiguously about the field, not about two different candidate decks.
const candidateDeck = buildDeckSnapshot(deckInput, {
  asOf: ASOF,
  source: SOURCE,
  idStem: "task-12-e2e-deck-ace",
});
const opponentDeck = buildDeckSnapshot(
  { ...deckInput, name: "Teach OP16 (offline e2e fixture)", leader: OPPONENT_LEADER },
  { asOf: ASOF, source: SOURCE, idStem: "task-12-e2e-deck-teach" },
);

function deckEntry(deck) {
  return {
    deckSnapshotId: deck.snapshotId,
    contentHash: deck.contentHash,
    gameplayHash: deck.data.gameplayHash,
    weight: 1,
  };
}

function publishAll(root, snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot === null) continue;
    publishImmutableArtifact(derivedArtifactPath(root, snapshot.kind, snapshot.snapshotId), snapshot);
  }
}

function manifestDraft({ identity, artifacts, field, markets }) {
  return {
    schemaVersion: 1,
    environmentKey: environmentKey({ ...identity, asOf: ASOF }),
    kind: "official",
    edition: identity.edition,
    metagameRegion: identity.metagameRegion,
    language: identity.language,
    formatId: identity.formatId,
    asOf: ASOF,
    timeZone: identity.timeZone,
    references: {
      rules: snapshotRef(artifacts.rules),
      cardPool: snapshotRef(artifacts.cardPool),
      banlist: snapshotRef(artifacts.banlist),
      constructionPolicy: snapshotRef(artifacts.construction),
      simulationCapability: snapshotRef(artifacts.capability),
      field: snapshotRef(field),
      market: markets.map(snapshotRef),
    },
    opponents: [
      { archetypeId: `leader:${CANDIDATE_LEADER}`, representativeDecks: [deckEntry(candidateDeck)] },
      { archetypeId: `leader:${OPPONENT_LEADER}`, representativeDecks: [deckEntry(opponentDeck)] },
    ],
    matchupPolicy: {
      mode: "simulate",
      observedMatchupRefs: [],
      proxyPriorRef: null,
      minimumGamesPerSeat: 200,
      requiredFieldCoverage: 1,
      requiredMatchupCoverage: 1,
      turnOrderWeights: { play: 0.5, draw: 0.5 },
      roundPolicy: {
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
        clockModelRef: artifacts.clock === null ? null : snapshotRef(artifacts.clock),
      },
    },
    latestPolicy: {
      fieldMaxAgeDays: 30,
      marketMaxAgeDays: 7,
      marketStalenessBlocksStrength: false,
    },
  };
}

/**
 * One whole environment, from raw evidence to a finished report.
 *
 * NOTHING is defaulted: the repository root, the results root, the cache root, `now` and the
 * runner are all injected. No alias is ever published -- the Manifest is resolved by its own
 * immutable id and content hash, so this test cannot advance `SC/latest` even by accident.
 */
function runEnvironment({ root, edition, marketArm = "a", clock = "expired", script }) {
  const identity = edition === "SC" ? SC : EN;
  const { event, field } = edition === "SC" ? scFieldFromRawCapture() : enFieldFromSyntheticEvent();
  const artifacts = buildSupportingArtifacts(identity, { clock });
  const markets = edition === "SC" ? [marketFromRawCapture(marketArm)] : [];
  publishAll(root, [
    artifacts.rules,
    artifacts.cardPool,
    artifacts.banlist,
    artifacts.construction,
    artifacts.capability,
    artifacts.clock,
    field,
    candidateDeck,
    opponentDeck,
    ...markets,
  ]);

  const manifest = buildManifest(manifestDraft({ identity, artifacts, field, markets }), { root });
  publishManifest({ root, manifest, updatedAt: NOW });

  const resolved = resolveEnvironment(
    {
      selector: { manifestId: manifest.manifestId, contentHash: manifest.contentHash },
      candidateDeckRef: snapshotRef(candidateDeck),
      now: NOW,
      allowDiagnostic: true,
    },
    { root },
  );

  const plan = expandSimulationPlan(resolved, candidateDeck, {
    ...SETTINGS,
    opponentDecks: [candidateDeck, opponentDeck],
  });
  const outcome = executeSimulationPlan(plan, {
    runner: createFakeRunner(script, { name: `task-12-e2e-${edition.toLowerCase()}` }),
    cacheRoot: join(root, "cache"),
    resultsRoot: join(root, "results"),
    now: NOW,
  });
  const report = aggregateEnvironment({ ...outcome, now: NOW });
  return { identity, event, field, artifacts, markets, manifest, resolved, plan, report };
}

/**
 * IEEE-754 tolerance. Every expectation below is hand-derived exact decimal arithmetic, but the
 * pipeline reaches it by summing weighted float64 products, so 0.4875 arrives as
 * 0.48750000000000004. 1e-12 is far tighter than any real difference this test distinguishes (the
 * SC/EN gap is 0.025) while absorbing the last-bit noise.
 */
const EPSILON = 1e-12;

function assertClose(actual, expected, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < EPSILON,
    `${label}: expected ${expected} +/- ${EPSILON}, got ${actual}`,
  );
}

/** assert.throws returns undefined, so the error itself is captured here. */
function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected a throw, but none happened" });
}

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "environment-e2e-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ================================================================== *
 * 5. The acquisition boundary
 * ================================================================== */

const IMPORT_PATTERN = /(?:^|[\s;{(])(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every relative-import-reachable file, and every specifier seen, starting from `entries`. */
function importClosure(entries) {
  const files = new Map();
  const queue = entries.map((entry) => fileURLToPath(new URL(entry, REPO_URL)));
  while (queue.length > 0) {
    const file = queue.shift();
    if (files.has(file)) continue;
    const source = readFileSync(file, "utf8");
    const specifiers = new Set();
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (typeof specifier === "string") specifiers.add(specifier);
    }
    files.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      queue.push(fileURLToPath(new URL(specifier, pathToFileURL(file))));
    }
  }
  return files;
}

const PIPELINE_ENTRIES = Object.freeze([
  "environment/index.mjs",
  "environment/alias.mjs",
  "tools/jihuanshe_normalize.mjs",
  "tests/fixtures/environment/fake-simulation-runner.mjs",
]);

test("the pipeline's static import graph contains no acquisition module at all", () => {
  const closure = importClosure(PIPELINE_ENTRIES);

  // Non-vacuity first: if the walker found nothing, everything below is meaningless.
  const relative = new Set([...closure.keys()].map((file) => file.slice(REPO_ROOT.length)));
  for (const expected of [
    "environment/manifest.mjs",
    "environment/field.mjs",
    "environment/resolver.mjs",
    "environment/simulation.mjs",
    "environment/report.mjs",
    "environment/matchup.mjs",
    "tools/jihuanshe_normalize.mjs",
    "sim/environment-contract.mjs",
  ]) {
    assert.ok(relative.has(expected), `the import walker never reached ${expected}`);
  }
  assert.ok(relative.size >= 20, `implausibly small closure: ${relative.size} files`);

  for (const [file, specifiers] of closure) {
    const name = basename(file);
    assert.ok(
      !/^jihuanshe_(capture|lifecycle|reader|refresh)\.mjs$/.test(name),
      `${name} is an acquisition module and must not be reachable`,
    );
    for (const specifier of specifiers) {
      for (const pattern of FORBIDDEN_SPECIFIERS) {
        assert.ok(
          !pattern.test(specifier),
          `${file.slice(REPO_ROOT.length)} imports ${specifier}, which ${pattern} forbids`,
        );
      }
    }
  }
});

test("exactly one module in the graph can start a child process, and it is the engine runner", () => {
  const closure = importClosure(PIPELINE_ENTRIES);
  const importers = [...closure]
    .filter(([, specifiers]) => [...specifiers].some((specifier) => CHILD_PROCESS_SPECIFIERS.has(specifier)))
    .map(([file]) => file.slice(REPO_ROOT.length))
    .sort();
  // environment/simulation.mjs holds `createSimulateShRunner`, the real vendored-engine seam. This
  // test injects a fake runner instead, so that function is never called here -- and the poison
  // below proves it could not run even if it were.
  assert.deepEqual(importers, ["environment/simulation.mjs"]);
});

test("the poisoned child-process seam really throws, from inside the real module", () => {
  // Non-vacuity for the whole dynamic half: this is the one genuine spawn site in the pipeline,
  // reached through the real module that was loaded under the hook.
  assert.ok(
    poisonedImporters.has(new URL("environment/simulation.mjs", REPO_URL).href),
    "environment/simulation.mjs was not handed the poisoned child_process",
  );
  const runner = createSimulateShRunner({ repoRoot: REPO_ROOT });
  assert.throws(
    () => runner.run({ jobPath: join(HOOK_ROOT, "job.json"), outPath: join(HOOK_ROOT, "out.json") }),
    (error) => error.code === "CHILD_PROCESS_FORBIDDEN",
  );
});

test("importing an acquisition module is refused by the loader hook", async () => {
  const before = refusedSpecifiers.length;
  await assert.rejects(
    () => import("../tools/jihuanshe_capture.mjs"),
    (error) => error.code === "FORBIDDEN_IMPORT",
  );
  await assert.rejects(
    () => import("../tools/jihuanshe_lifecycle.mjs"),
    (error) => error.code === "FORBIDDEN_IMPORT",
  );
  assert.equal(refusedSpecifiers.length - before, 2);
});

/* ================================================================== *
 * 6. Fixture hygiene
 * ================================================================== */

test("every end-to-end fixture is accounted for and declares itself fixture-only", () => {
  for (const directory of [SC_FIXTURES, EN_FIXTURES]) {
    const manifest = json(join(directory, "fixture-manifest.json"));
    assert.equal(manifest.fixture_only, true, directory);

    const onDisk = readdirSync(directory).filter((name) => name !== "fixture-manifest.json").sort();
    assert.deepEqual(onDisk, Object.keys(manifest.files).sort(), `${directory} has an unlisted file`);
    assert.ok(onDisk.length > 0);

    for (const [name, entry] of Object.entries(manifest.files)) {
      const body = json(join(directory, name));
      if (entry.markerCarried === true) {
        assert.equal(body.fixture_only, true, `${name} does not declare fixture_only`);
        continue;
      }
      // The only permitted exemption is a strict CaptureResult v2 envelope, whose top-level keys
      // the normalizer allowlists. It must still be a capture envelope, and it must say why.
      assert.match(name, /^raw-.*capture.*\.json$/, `${name} may not skip the marker`);
      assert.equal(body.schemaVersion, 2, name);
      assert.equal(body.status, "ok", name);
      assert.ok(typeof entry.reason === "string" && entry.reason.length > 0, name);
    }
  }
});

test("the two outcome scripts are byte-identical, so only the field weights can differ", () => {
  assert.deepEqual(scOutcomeScript, enOutcomeScript);
  assert.equal(
    readFileSync(join(SC_FIXTURES, "outcome-script.json"), "utf8"),
    readFileSync(join(EN_FIXTURES, "outcome-script.json"), "utf8"),
  );
});

/* ================================================================== *
 * 7. The end-to-end run
 * ================================================================== */

test("raw SC capture bytes become a resolved, reported SC environment", () => {
  withRoot((root) => {
    const sc = runEnvironment({ root, edition: "SC", script: scOutcomeScript });

    // Normalization really ran: the event carries the capture's own hash scope and a full field.
    assert.equal(sc.event.kind, "tournament_event");
    assert.equal(sc.event.source.provider, "jihuanshe");
    assert.equal(sc.event.source.captureHashScope, "exact-raw-envelope-bytes");
    assert.equal(sc.event.data.evidenceBlocks.field.sampleFrame, "full-field");
    assert.equal(sc.event.data.evidenceBlocks.field.unresolvedParticipants, 0);

    // Aggregation really ran: 8 participants, 3 Ace / 5 Teach.
    assert.equal(sc.field.data.totalParticipants, 8);
    assert.deepEqual(
      sc.field.data.archetypes.map((row) => [row.archetypeId, row.share]),
      [["leader:OP16-001", 0.375], ["leader:OP16-080", 0.625]],
    );

    // The Manifest is native SC and pins every reference by content hash.
    assert.equal(sc.manifest.kind, "official");
    assert.equal(sc.manifest.edition, "SC");
    assert.match(sc.manifest.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(sc.resolved.matchupEvidence.applicability, "native");
    assert.equal(sc.resolved.matchupEvidence.method, "simulated");

    // The report's EV is the field weights times the scripted win rates, exactly.
    assert.equal(sc.report.kind, "environment-evaluation-report");
    assertClose(sc.report.ev.play, EXPECTED.SC.play, "SC ev.play");
    assertClose(sc.report.ev.draw, EXPECTED.SC.draw, "SC ev.draw");
    assertClose(sc.report.ev.overall, EXPECTED.SC.overall, "SC ev.overall");
    assert.equal(sc.report.coverage.cells, 4);
    assert.equal(sc.report.coverage.renormalized, false);
  });
});

test("a simulated report never claims official tournament strength, and says why", () => {
  withRoot((root) => {
    // No clock model authorizes this environment, which is the honest state of the repository:
    // nothing here infers a ClockModel yet, so no accepted-and-effective model exists.
    const diagnostic = runEnvironment({ root, edition: "SC", clock: "expired", script: scOutcomeScript });
    assert.equal(diagnostic.report.evaluationMode, "diagnostic_estimate");
    assert.equal(diagnostic.report.clockRef, null);
    assert.equal(diagnostic.report.officialStrengthClaim, false);
    assert.equal(diagnostic.report.strengthClaimWithheld, true);
    assert.ok(diagnostic.report.blockers.some((blocker) => blocker.code === "clock_model_unavailable"));
  });

  withRoot((root) => {
    // ...and even WITH an accepted clock model, the claim is still withheld, because no
    // round-timeout adjudicator has run. A timed-out round is a double loss, so an unadjudicated
    // zero is unmeasured rather than measured.
    const withClock = runEnvironment({
      root,
      edition: "SC",
      clock: "accepted",
      script: scOutcomeScript,
    });
    assert.equal(withClock.report.evaluationMode, "official");
    assert.notEqual(withClock.report.clockRef, null);
    assert.equal(withClock.report.officialStrengthClaim, false);
    assert.equal(withClock.report.strengthClaimWithheld, true);
    assert.equal(withClock.report.timeoutAdjudication.applied, false);
    assert.equal(withClock.report.timeoutAdjudication.applicable, true);
    assert.deepEqual(
      withClock.report.blockers.map((blocker) => blocker.code),
      ["round_timeout_unadjudicated"],
    );
  });
});

test("an ABSENT clock reference still produces a report, and its blocker carries a cause", () => {
  withRoot((root) => {
    // REGRESSION (fix round 1). `roundPolicy.clockModelRef: null` used to resolve and then produce
    // no report at all: the blocker carried `cause: undefined`, which canonical hashing rejects.
    // Nothing else in the repository covers the absent-reference path -- every other fixture reaches
    // diagnostic_estimate through a gate that EVALUATED and closed.
    const absent = runEnvironment({ root, edition: "SC", clock: "absent", script: scOutcomeScript });

    assert.equal(absent.manifest.matchupPolicy.roundPolicy.clockModelRef, null);
    assert.equal(absent.report.kind, "environment-evaluation-report");
    assert.match(absent.report.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(absent.report.evaluationMode, "diagnostic_estimate");
    assert.equal(absent.report.clockRef, null);
    assert.equal(absent.report.officialStrengthClaim, false);
    assert.equal(absent.report.strengthClaimWithheld, true);

    const blocker = absent.report.blockers.find((row) => row.code === "clock_model_unavailable");
    assert.ok(blocker, "the absent clock reference produced no clock blocker");
    assert.equal(blocker.reason, "clock_model_absent");
    // The regression itself: a key that is PRESENT but `undefined` is what broke hashing, so both
    // halves are asserted -- the key exists, and its value is a real string.
    assert.ok(Object.hasOwn(blocker, "cause"), "the blocker has no cause key at all");
    assert.notEqual(blocker.cause, undefined);
    assert.equal(blocker.cause, "clock_model_ref_null");

    // The EV is unaffected by which clock gate closed: this is the same field and the same games.
    assertClose(absent.report.ev.overall, EXPECTED.SC.overall, "absent-clock ev.overall");
  });

  withRoot((root) => {
    // ...and the two closed-clock gates are genuinely different gates, not two spellings of one.
    const expired = runEnvironment({ root, edition: "SC", clock: "expired", script: scOutcomeScript });
    const expiredBlocker = expired.report.blockers.find((row) => row.code === "clock_model_unavailable");
    assert.ok(expiredBlocker);
    assert.equal(expiredBlocker.reason, "clock_gate_closed");
    assert.notEqual(expiredBlocker.reason, "clock_model_absent");
    assert.ok(Object.hasOwn(expiredBlocker, "cause"));
    assert.notEqual(expiredBlocker.cause, undefined);
  });
});

test("SC and EN produce different weights, separate outputs, and an unblended comparison", () => {
  withRoot((root) => {
    const sc = runEnvironment({ root, edition: "SC", script: scOutcomeScript });
    const en = runEnvironment({ root, edition: "EN", script: enOutcomeScript });

    // Two populations, two identities, two Manifests. Nothing shared but the decks.
    assert.notEqual(sc.manifest.manifestId, en.manifest.manifestId);
    assert.notEqual(sc.manifest.environmentKey, en.manifest.environmentKey);
    assert.notEqual(sc.field.contentHash, en.field.contentHash);
    assert.notEqual(sc.report.contentHash, en.report.contentHash);
    assert.equal(sc.report.candidate.gameplayHash, en.report.candidate.gameplayHash);

    // The field weights differ, and they are the ONLY reason the EVs differ.
    const weightsOf = (report) => report.strata.map((row) => [row.archetypeId, row.fieldWeight]);
    assert.deepEqual(weightsOf(sc.report), [
      ["leader:OP16-001", EXPECTED.SC.weights.Ace],
      ["leader:OP16-080", EXPECTED.SC.weights.Teach],
    ]);
    assert.deepEqual(weightsOf(en.report), [
      ["leader:OP16-001", EXPECTED.EN.weights.Ace],
      ["leader:OP16-080", EXPECTED.EN.weights.Teach],
    ]);
    assertClose(en.report.ev.play, EXPECTED.EN.play, "EN ev.play");
    assertClose(en.report.ev.draw, EXPECTED.EN.draw, "EN ev.draw");
    assertClose(en.report.ev.overall, EXPECTED.EN.overall, "EN ev.overall");

    const comparison = compareEnvironments(
      [
        { label: sc.manifest.manifestId, report: sc.report },
        { label: en.manifest.manifestId, report: en.report },
      ],
      { now: NOW },
    );

    assert.equal(comparison.kind, "environment-cross-environment-comparison");
    assert.equal(comparison.environments.length, 2);
    // Each side keeps its OWN report, byte for byte.
    assert.deepEqual(comparison.environments[0].report, sc.report);
    assert.deepEqual(comparison.environments[1].report, en.report);

    // A labelled difference and nothing else: no pooled EV, no shared denominator, no joint
    // interval, no ranking across populations.
    assertClose(comparison.difference.play, EXPECTED.SC.play - EXPECTED.EN.play, "difference.play");
    assertClose(comparison.difference.draw, EXPECTED.SC.draw - EXPECTED.EN.draw, "difference.draw");
    assertClose(comparison.difference.overall, EXPECTED.SC.overall - EXPECTED.EN.overall, "difference.overall");
    assert.equal(comparison.difference.confidence, null);
    assert.equal(comparison.difference.denominator, null);
    assert.deepEqual(
      Object.keys(comparison.difference).sort(),
      ["confidence", "denominator", "draw", "label", "overall", "play"],
    );
    assert.deepEqual(Object.keys(comparison).sort(), [
      "contentHash",
      "difference",
      "environments",
      "generatedAt",
      "kind",
      "schemaVersion",
    ]);
    for (const forbidden of ["pooled", "blended", "combined", "aggregate", "ranking", "winner"]) {
      assert.ok(
        !JSON.stringify(comparison).toLowerCase().includes(forbidden),
        `the comparison mentions ${forbidden}`,
      );
    }
  });
});

test("every hash is reproduced exactly by a second, independent run", () => {
  const identifiers = (label) => withRoot((root) => {
    const sc = runEnvironment({ root, edition: "SC", script: scOutcomeScript });
    return {
      label,
      eventSnapshotId: sc.event.snapshotId,
      eventContentHash: sc.event.contentHash,
      eventEvidenceHash: sc.event.data.eventEvidenceHash,
      fieldSnapshotId: sc.field.snapshotId,
      fieldContentHash: sc.field.contentHash,
      marketContentHash: sc.markets[0].contentHash,
      manifestId: sc.manifest.manifestId,
      manifestContentHash: sc.manifest.contentHash,
      planHash: sc.plan.planHash,
      jobIds: sc.plan.jobs.map((entry) => entry.job.jobId),
      reportContentHash: sc.report.contentHash,
      ev: { ...sc.report.ev },
      confidence: sc.report.confidence,
    };
  });

  const first = identifiers("first");
  const second = identifiers("second");
  assert.deepEqual({ ...second, label: "first" }, first);
  assert.match(first.reportContentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.jobIds.length, 4);
});

test("changing the market fixture moves no EV and no confidence value", () => {
  const armed = (arm) => withRoot((root) => {
    const sc = runEnvironment({ root, edition: "SC", marketArm: arm, script: scOutcomeScript });
    return {
      market: sc.markets[0].contentHash,
      marketRefs: sc.report.metadata.marketRefs,
      manifest: sc.manifest.contentHash,
      ev: sc.report.ev,
      confidence: sc.report.confidence,
      strata: sc.report.strata,
      coverage: sc.report.coverage,
    };
  });

  const a = armed("a");
  const b = armed("b");
  // Non-vacuity: the two arms really are different evidence.
  assert.notEqual(a.market, b.market);
  assert.notEqual(a.manifest, b.manifest);
  assert.notDeepEqual(a.marketRefs, b.marketRefs);
  // ...and not one number that bears on strength moved.
  assert.deepEqual(b.ev, a.ev);
  assert.deepEqual(b.confidence, a.confidence);
  assert.deepEqual(b.strata, a.strata);
  assert.deepEqual(b.coverage, a.coverage);
});

test("the legacy EN matrix is refused as native AND as proxy environment evidence", () => {
  withRoot((root) => {
    const artifacts = buildSupportingArtifacts(SC, { clock: "expired" });
    const { field } = scFieldFromRawCapture();

    // The adapter a future migration would have to write: wrap the real legacy matrix in a field
    // artifact carrying its OWN declared provenance. Everything else about it is valid, so the
    // ONLY thing that can refuse it is the evidence status.
    const legacyMatrix = json(join(REPO_ROOT, "data", "op16-matchup-matrix.json"));
    assert.equal(legacyMatrix._meta.evidence_status, "legacy_unverified");
    assert.equal(legacyMatrix._meta.source_edition, "EN");
    assert.equal(legacyMatrix._meta.environment_eligible, false);

    const legacyField = finalizeSnapshot(
      {
        schemaVersion: 1,
        kind: "field",
        environment: { ...SC },
        asOf: ASOF,
        source: {
          provider: "legacy",
          surface: "matchup-matrix",
          sourceRef: { artifact: "data/op16-matchup-matrix.json" },
          evidenceStatus: legacyMatrix._meta.evidence_status,
        },
        coverage: { status: "complete", warnings: [], missingFields: [] },
        data: { ...field.data },
      },
      "task-12-e2e-legacy-field",
    );

    publishAll(root, [
      artifacts.rules,
      artifacts.cardPool,
      artifacts.banlist,
      artifacts.construction,
      artifacts.capability,
      artifacts.clock,
      field,
      legacyField,
      candidateDeck,
      opponentDeck,
    ]);

    const clean = manifestDraft({ identity: SC, artifacts, field, markets: [] });
    // Control: the same draft with verified evidence builds. Without this the refusals below
    // could come from anything.
    assert.match(buildManifest(clean, { root }).manifestId, /^SC-CN-zh-Hans/);

    const asNative = structuredClone(clean);
    asNative.references.field = snapshotRef(legacyField);
    const nativeFailure = codeOf(() => buildManifest(asNative, { root }));
    assert.ok(nativeFailure instanceof EnvironmentError);
    assert.equal(nativeFailure.code, "legacy_evidence_rejected");
    // The reported path proves WHICH seam refused it, so this arm cannot be satisfied by a failure
    // somewhere earlier in reference validation.
    assert.equal(nativeFailure.details.path, "references.field");

    const asProxyField = structuredClone(asNative);
    asProxyField.kind = "proxy";
    const proxyFieldFailure = codeOf(() => buildManifest(asProxyField, { root }));
    assert.ok(proxyFieldFailure instanceof EnvironmentError);
    assert.equal(proxyFieldFailure.code, "legacy_evidence_rejected");
    assert.equal(proxyFieldFailure.details.path, "references.field");

    // ...and through the ONE seam the design permits cross-edition borrowing through. Flipping
    // `kind` on a native field (above) never touches `matchupPolicy.proxyPriorRef`, so on its own it
    // does not demonstrate that a legacy matrix cannot enter as a genuine EN prior. This does.
    const legacyPrior = finalizeSnapshot(
      {
        schemaVersion: 1,
        kind: "matchup",
        environment: { ...EN },
        asOf: ASOF,
        source: {
          provider: "legacy",
          surface: "matchup-matrix",
          sourceRef: { artifact: "data/op16-matchup-matrix.json" },
          evidenceStatus: legacyMatrix._meta.evidence_status,
        },
        coverage: { status: "complete", warnings: [], missingFields: [] },
        data: {
          method: "observed",
          applicability: "proxy",
          population: "EN ladder, 213084 games (legacy, never reconciled to one population)",
          window: { startLocalDate: "2026-07-01", asOf: ASOF, timeZone: EN.timeZone },
          roundPolicy: { stage: "swiss", roundDurationMinutes: 30, timeoutScoring: "double-loss" },
          cells: [],
        },
      },
      "task-12-e2e-legacy-prior",
    );
    publishAll(root, [legacyPrior]);

    const asProxyPrior = structuredClone(clean);
    asProxyPrior.kind = "proxy";
    asProxyPrior.matchupPolicy.proxyPriorRef = {
      snapshotId: legacyPrior.snapshotId,
      contentHash: legacyPrior.contentHash,
      originEdition: "EN",
      originEnvironmentKey: `EN:GLOBAL_EN:en:America/Los_Angeles:${EN.formatId}:${ASOF}`,
    };
    const priorFailure = codeOf(() => buildManifest(asProxyPrior, { root }));
    assert.ok(priorFailure instanceof EnvironmentError);
    assert.equal(priorFailure.code, "legacy_evidence_rejected");
    assert.equal(priorFailure.details.path, "matchupPolicy.proxyPriorRef");
  });
});

test("nothing in this repository's own data directory was written", () => {
  for (const relative of [
    join("data", "derived"),
    join("data", "sources"),
    join("data", "environment-aliases"),
    join("data", "manifests"),
  ]) {
    assert.equal(
      existsSync(join(REPO_ROOT, relative)),
      false,
      `${relative} exists: a pipeline defaulted to the checkout instead of an injected root`,
    );
  }
});

process.on("exit", () => rmSync(HOOK_ROOT, { recursive: true, force: true }));
