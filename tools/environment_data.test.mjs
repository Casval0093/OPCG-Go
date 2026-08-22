import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildCapabilitySnapshot } from "../environment/capability.mjs";
import { buildClockSnapshot } from "../environment/clock.mjs";
import { sha256Canonical } from "../environment/hash.mjs";
import { environmentKey } from "../environment/manifest.mjs";
import {
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
} from "../environment/rules.mjs";
import { finalizeSnapshot, snapshotRef } from "../environment/snapshot.mjs";
import { publishImmutableArtifact } from "../environment/store.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "tools", "environment_data.mjs");

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = "2026-08-21T10:00:00+08:00";
const AS_OF = "2026-08-20";
const SECOND_LEADER = "OP16-080";

const DERIVED_DIR = {
  rules: "rules",
  card_pool: "card-pool",
  banlist: "banlist",
  construction: "construction",
  deck: "deck",
  field: "field",
  "simulation-capability": "simulation-capability",
  "clock-model": "clock-model",
  matchup: "matchup",
  market: "market",
};

const SC = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};

const source = {
  provider: "fixture",
  surface: "environment",
  sourceRef: { fixtureId: "task-6-manifest" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: HASH_A,
};

function fixture(name) {
  return JSON.parse(readFileSync(join(REPO_ROOT, "tests", "fixtures", "environment", name), "utf8"));
}

const poolInput = fixture("card-pool-sc-op16.json");
const banlistInput = fixture("banlist-sc-op16.json");
const constructionInput = fixture("construction-standard.json");
const deckInput = fixture("deck-ace-op16.json");
const eventAInput = fixture("tournament-event-full-field-a.json");
const eventBInput = fixture("tournament-event-full-field-b.json");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.error, undefined);
  return result;
}

// Every invocation must print exactly one sanitized JSON object and nothing else.
function runJson(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.stderr, "", `stderr must stay empty, got: ${result.stderr}`);
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, 1, `expected exactly one output line, got ${lines.length}`);
  const parsed = JSON.parse(lines[0]);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return { status: result.status, json: parsed, stdout: result.stdout };
}

function publish(root, snapshot) {
  publishImmutableArtifact(
    join(root, "data", "derived", DERIVED_DIR[snapshot.kind], `${snapshot.snapshotId}.json`),
    snapshot,
  );
  return snapshot;
}

// Publishes the artifacts the CLI does not itself build, so the four
// subcommands can be exercised as a real pipeline on top of them.
function seedRepository(root) {
  const rules = publish(root, buildRulesSnapshot({
    ...SC,
    asOf: AS_OF,
    source,
    authority: { name: "Bandai official rules", authorityId: "bandai-sc" },
    documentRefs: [
      { documentId: "comprehensive-rules", version: "1.2.0", sourceHash: HASH_B },
      { documentId: "tournament-rules", version: "1.6.0", sourceHash: HASH_A },
    ],
    effectiveFrom: "2026-04-01",
    effectiveUntil: null,
    sourceHashes: [HASH_B, HASH_A],
  }));
  const cards = [
    ...poolInput.cards,
    {
      gameplayId: SECOND_LEADER,
      isLeader: true,
      colors: ["Black"],
      releasedAt: "2026-04-01",
      legalFrom: "2026-04-01",
      legalUntil: null,
      releaseEvidenceRef: "sc-op16-release",
    },
  ].map((card) => ({ ...card, rulesIdentityHash: rules.data.rulesIdentityHash }));
  const cardPool = publish(root, buildCardPoolSnapshot({ ...poolInput, ...SC, asOf: AS_OF, source, cards }));
  const banlist = publish(root, buildBanlistSnapshot({ ...banlistInput, ...SC, asOf: AS_OF, source }));
  const construction = publish(root, buildConstructionSnapshot({ ...constructionInput, ...SC, asOf: AS_OF, source }));

  const rows = cards.map((card) => ({
    printingId: card.gameplayId,
    gameplayId: card.gameplayId,
    effectText: null,
    triggerText: null,
    hasStructuredEffects: true,
  })).sort((left, right) => (left.printingId < right.printingId ? -1 : 1));
  const capability = publish(root, buildCapabilitySnapshot({
    ...SC,
    asOf: AS_OF,
    source: { adapter: "fixture-capability" },
    engineRevision: "engine-commit-fixture",
    engineWorktreeHash: HASH_A,
    patchDefinitionHash: HASH_B,
    policySourceHash: HASH_A,
    catalogContentHash: sha256Canonical(rows),
    catalogRows: rows,
    patchCheck: { status: "passed", command: "patch_engine.py --check" },
    limitations: {
      schemaVersion: 1,
      definitionId: "fixture-limitations-v1",
      limitations: [{
        code: "attack-target-selection",
        evidenceLocation: "docs/simulation.md",
        affectedCapability: "battle",
        status: "closed",
        blocksOfficialStrength: true,
      }],
    },
  }));

  const rulesRef = snapshotRef(rules);
  const clock = publish(root, buildClockSnapshot({
    ...SC,
    asOf: AS_OF,
    source: { adapter: "fixture-clock" },
    rulesSnapshotRef: rulesRef,
    tournamentStage: "swiss",
    roundDurationMinutes: 30,
    inputFeatures: [{ name: "turnCount", type: "integer", source: "simulation.turn_end" }],
    simulationEvents: [{ name: "turn_end", fields: ["turnNumber", "elapsedMs"] }],
    calibrationDatasets: [{
      datasetId: "sc-clock-calibration-fixture",
      contentHash: HASH_B,
      population: "SC Swiss fixture sample",
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
    effectiveUntil: null,
    roundTimeoutPolicy: {
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
      rulesSnapshotRef: rulesRef,
    },
  }));

  return { rules, cardPool, banlist, construction, capability, clock };
}

function eventSnapshot(input, localDate, eventKey, idStem) {
  return finalizeSnapshot(
    {
      ...input,
      environment: SC,
      asOf: AS_OF,
      data: { ...input.data, eventKey, time: { ...input.data.time, localDate } },
    },
    idStem,
  );
}

function writeInput(root, name, value) {
  const path = join(root, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "environment-data-cli-test-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Runs build-deck twice, build-field once, and build-manifest once, and
// returns everything the resolve subcommand needs.
function buildPipeline(root, { alias = "SC/latest", draftOverrides } = {}) {
  const seeded = seedRepository(root);

  const candidate = runJson([
    "build-deck",
    "--root", root,
    "--input", writeInput(root, "deck-ace-input", {
      deck: deckInput,
      asOf: AS_OF,
      source,
      idStem: "deck-ace-op16",
    }),
  ]);
  assert.equal(candidate.status, 0, JSON.stringify(candidate.json));
  const opponent = runJson([
    "build-deck",
    "--root", root,
    "--input", writeInput(root, "deck-teach-input", {
      deck: { ...deckInput, name: "Teach OP16 (fixture)", leader: SECOND_LEADER },
      asOf: AS_OF,
      source,
      idStem: "deck-teach-op16",
    }),
  ]);
  assert.equal(opponent.status, 0, JSON.stringify(opponent.json));

  const field = runJson([
    "build-field",
    "--root", root,
    "--input", writeInput(root, "field-input", {
      identity: SC,
      window: { startLocalDate: "2026-07-22", asOf: AS_OF, timeZone: SC.timeZone },
      selectionPolicy: { id: "fixture-selection-v1" },
      events: [
        eventSnapshot(eventAInput, "2026-08-18", "fixture-full-field-a", "fixture-event-a"),
        eventSnapshot(eventBInput, "2026-08-19", "fixture-full-field-b", "fixture-event-b"),
      ],
    }),
  ]);
  assert.equal(field.status, 0, JSON.stringify(field.json));

  const draft = {
    schemaVersion: 1,
    environmentKey: environmentKey({ ...SC, asOf: AS_OF }),
    kind: "official",
    edition: SC.edition,
    metagameRegion: SC.metagameRegion,
    language: SC.language,
    formatId: SC.formatId,
    asOf: AS_OF,
    timeZone: SC.timeZone,
    references: {
      rules: snapshotRef(seeded.rules),
      cardPool: snapshotRef(seeded.cardPool),
      banlist: snapshotRef(seeded.banlist),
      constructionPolicy: snapshotRef(seeded.construction),
      simulationCapability: snapshotRef(seeded.capability),
      field: { snapshotId: field.json.snapshotId, contentHash: field.json.contentHash },
      market: [],
    },
    opponents: [
      {
        archetypeId: "leader:OP16-001",
        representativeDecks: [{
          deckSnapshotId: candidate.json.snapshotId,
          contentHash: candidate.json.contentHash,
          gameplayHash: candidate.json.gameplayHash,
          weight: 1,
        }],
      },
      {
        archetypeId: `leader:${SECOND_LEADER}`,
        representativeDecks: [{
          deckSnapshotId: opponent.json.snapshotId,
          contentHash: opponent.json.contentHash,
          gameplayHash: opponent.json.gameplayHash,
          weight: 1,
        }],
      },
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
        clockModelRef: snapshotRef(seeded.clock),
      },
    },
    latestPolicy: { fieldMaxAgeDays: 30, marketMaxAgeDays: 7, marketStalenessBlocksStrength: false },
  };
  if (draftOverrides) draftOverrides(draft);

  const manifestArgs = [
    "build-manifest",
    "--root", root,
    "--input", writeInput(root, "manifest-draft", draft),
    "--now", NOW,
  ];
  if (alias) manifestArgs.push("--alias", alias);
  const manifest = runJson(manifestArgs);
  assert.equal(manifest.status, 0, JSON.stringify(manifest.json));

  return { seeded, candidate: candidate.json, opponent: opponent.json, field: field.json, manifest: manifest.json };
}

/* ------------------------------------------------------------------ */

test("build-deck publishes an immutable DeckSnapshot and prints one JSON object", () => {
  withRoot((root) => {
    const result = runJson([
      "build-deck",
      "--root", root,
      "--input", writeInput(root, "deck-input", { deck: deckInput, asOf: AS_OF, source, idStem: "deck-ace-op16" }),
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.status, "ok");
    assert.equal(result.json.command, "build-deck");
    assert.match(result.json.snapshotId, /^deck-ace-op16-[0-9a-f]{16}$/);
    assert.match(result.json.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.json.gameplayHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(existsSync(join(root, "data", "derived", "deck", `${result.json.snapshotId}.json`)), true);

    // Republishing the identical deck is idempotent, not a collision.
    const again = runJson([
      "build-deck",
      "--root", root,
      "--input", join(root, "deck-input.json"),
    ]);
    assert.equal(again.status, 0);
    assert.equal(again.json.contentHash, result.json.contentHash);
  });
});

test("build-field publishes a FieldSnapshot from verified event snapshots", () => {
  withRoot((root) => {
    const result = runJson([
      "build-field",
      "--root", root,
      "--input", writeInput(root, "field-input", {
        identity: SC,
        window: { startLocalDate: "2026-07-22", asOf: AS_OF, timeZone: SC.timeZone },
        selectionPolicy: { id: "fixture-selection-v1" },
        events: [
          eventSnapshot(eventAInput, "2026-08-18", "fixture-full-field-a", "fixture-event-a"),
          eventSnapshot(eventBInput, "2026-08-19", "fixture-full-field-b", "fixture-event-b"),
        ],
      }),
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.command, "build-field");
    assert.equal(result.json.totalParticipants, 12);
    assert.equal(existsSync(join(root, "data", "derived", "field", `${result.json.snapshotId}.json`)), true);
  });
});

test("build-field refuses a tampered event snapshot", () => {
  withRoot((root) => {
    const event = eventSnapshot(eventAInput, "2026-08-18", "fixture-full-field-a", "fixture-event-a");
    const result = runJson([
      "build-field",
      "--root", root,
      "--input", writeInput(root, "field-input", {
        identity: SC,
        window: { startLocalDate: "2026-07-22", asOf: AS_OF, timeZone: SC.timeZone },
        selectionPolicy: { id: "fixture-selection-v1" },
        events: [{ ...event, asOf: "2026-08-19" }],
      }),
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.json.status, "error");
    assert.equal(result.json.code, "snapshot_hash_mismatch");
    assert.equal(existsSync(join(root, "data", "derived", "field")), false);
  });
});

test("build-manifest publishes the immutable Manifest and advances the alias", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);

    assert.equal(pipeline.manifest.status, "ok");
    assert.equal(pipeline.manifest.command, "build-manifest");
    assert.match(pipeline.manifest.manifestId, /^SC-CN-zh-Hans-Asia-Shanghai-standard-block2-op16-2026-08-20-[0-9a-f]{16}$/);
    assert.equal(pipeline.manifest.alias, "SC/latest");
    assert.equal(existsSync(join(root, "data", "environments", `${pipeline.manifest.manifestId}.json`)), true);

    const aliasRecord = JSON.parse(readFileSync(join(root, "data", "environment-aliases", "SC", "latest.json"), "utf8"));
    assert.deepEqual(aliasRecord, {
      schemaVersion: 1,
      alias: "SC/latest",
      manifestId: pipeline.manifest.manifestId,
      manifestHash: pipeline.manifest.contentHash,
      updatedAt: NOW,
    });
  });
});

test("build-manifest without an alias leaves the alias namespace untouched", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root, { alias: null });

    assert.equal(pipeline.manifest.alias, null);
    assert.equal(existsSync(join(root, "data", "environments", `${pipeline.manifest.manifestId}.json`)), true);
    assert.equal(existsSync(join(root, "data", "environment-aliases")), false);
  });
});

test("resolve prints the concrete plan for an aliased environment", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);
    const result = runJson([
      "resolve",
      "--root", root,
      "--selector", "SC/latest",
      "--candidate-deck-id", pipeline.candidate.snapshotId,
      "--candidate-deck-hash", pipeline.candidate.contentHash,
      "--now", NOW,
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.status, "ok");
    assert.equal(result.json.command, "resolve");
    assert.equal(result.json.resolved.requestedEnvironment, "SC/latest");
    assert.equal(result.json.resolved.evaluationMode, "official");
    assert.equal(result.json.resolved.manifestRef.manifestId, pipeline.manifest.manifestId);
    assert.equal(result.json.resolved.strata.length, 2);
    assert.equal(result.json.resolved.minimumCompletedGamesPerSeat, 200);
  });
});

test("resolve accepts an immutable manifestId plus its full hash", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root, { alias: null });
    const result = runJson([
      "resolve",
      "--root", root,
      "--manifest-id", pipeline.manifest.manifestId,
      "--content-hash", pipeline.manifest.contentHash,
      "--candidate-deck-id", pipeline.candidate.snapshotId,
      "--candidate-deck-hash", pipeline.candidate.contentHash,
      "--now", NOW,
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.resolved.requestedEnvironment, pipeline.manifest.manifestId);
  });
});

test("resolve fails closed with a stable code, stage, and exit 1", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);
    const result = runJson([
      "resolve",
      "--root", root,
      "--selector", "SC/latest",
      "--candidate-deck-id", pipeline.candidate.snapshotId,
      "--candidate-deck-hash", pipeline.candidate.contentHash,
      "--now", "2026-11-01T10:00:00+08:00",
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.json.status, "error");
    assert.equal(result.json.command, "resolve");
    assert.equal(result.json.code, "stale_latest");
    assert.equal(result.json.stage, "freshness");
    assert.equal(typeof result.json.path, "string");
    assert.equal(result.stdout.includes(root), false, "the sanitized result must not leak repository paths");
  });
});

test("resolve refuses an environment key as a selector", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);
    const result = runJson([
      "resolve",
      "--root", root,
      "--selector", environmentKey({ ...SC, asOf: AS_OF }),
      "--candidate-deck-id", pipeline.candidate.snapshotId,
      "--candidate-deck-hash", pipeline.candidate.contentHash,
      "--now", NOW,
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.json.code, "environment_not_found");
    assert.equal(result.json.stage, "selector");
  });
});

test("production defaults --now only at the command boundary", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);
    const result = runJson([
      "resolve",
      "--root", root,
      "--selector", "SC/latest",
      "--candidate-deck-id", pipeline.candidate.snapshotId,
      "--candidate-deck-hash", pipeline.candidate.contentHash,
    ]);

    // The library never defaults `now`; the command boundary does. Whatever the
    // host clock says, the failure must never be "you did not supply a clock".
    assert.notEqual(result.json.code, "resolver_input_invalid");
    assert.ok(result.status === 0 || result.status === 1);
  });
});

test("unknown subcommands, unknown flags, and missing inputs print one error object", () => {
  withRoot((root) => {
    for (const args of [
      [],
      ["not-a-command", "--root", root],
      ["build-deck", "--root", root, "--nonsense", "x"],
      ["build-deck", "--root", root],
      ["resolve", "--root", root, "--selector", "SC/latest"],
      ["build-deck", "--root", root, "--input", join(root, "absent.json")],
    ]) {
      const result = runJson(args);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.equal(result.json.status, "error", JSON.stringify(args));
      assert.equal(typeof result.json.code, "string", JSON.stringify(args));
    }
  });
});

test("the CLI never writes outside the repository root it was given", () => {
  withRoot((root) => {
    const pipeline = buildPipeline(root);
    assert.equal(existsSync(join(REPO_ROOT, "data", "environments", `${pipeline.manifest.manifestId}.json`)), false);
  });
});
