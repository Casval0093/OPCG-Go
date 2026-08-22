import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { buildCapabilitySnapshot } from "./capability.mjs";
import { buildClockSnapshot } from "./clock.mjs";
import { buildDeckSnapshot } from "./deck.mjs";
import { EnvironmentError } from "./errors.mjs";
import { buildFieldSnapshot } from "./field.mjs";
import { hashProjection, sha256Canonical } from "./hash.mjs";
import {
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
} from "./rules.mjs";
import { finalizeSnapshot, snapshotRef } from "./snapshot.mjs";
import { publishImmutableArtifact } from "./store.mjs";

import { buildManifest, environmentKey, publishManifest, verifyManifest } from "./manifest.mjs";
import { RESOLVER_ERROR_CODES, RESOLVER_STAGES, resolveEnvironment, resolverErrorJson } from "./resolver.mjs";

/* ------------------------------------------------------------------ *
 * Deterministic synthetic environment (same construction as
 * environment/manifest.test.mjs; the golden Manifest fixture ties the
 * two harnesses together and fails loudly if they ever drift apart).
 * ------------------------------------------------------------------ */

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

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
const EN = {
  edition: "EN",
  metagameRegion: "GLOBAL_EN",
  language: "en",
  formatId: "standard-block2-op16",
  timeZone: "America/Los_Angeles",
};
const NOW = "2026-08-21T10:00:00+08:00";

const source = {
  provider: "fixture",
  surface: "environment",
  sourceRef: { fixtureId: "task-6-manifest" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: HASH_A,
};

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../tests/fixtures/environment/${name}`, import.meta.url)));
}

const poolInput = fixture("card-pool-sc-op16.json");
const banlistInput = fixture("banlist-sc-op16.json");
const constructionInput = fixture("construction-standard.json");
const deckInput = fixture("deck-ace-op16.json");
const eventAInput = fixture("tournament-event-full-field-a.json");
const eventBInput = fixture("tournament-event-full-field-b.json");

const SECOND_LEADER = "OP16-080";

function poolCards(rulesIdentityHash) {
  return [
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
  ].map((card) => ({ ...card, rulesIdentityHash }));
}

function catalogRows(skip = []) {
  return [...poolInput.cards.map((card) => card.gameplayId), SECOND_LEADER]
    .filter((gameplayId) => !skip.includes(gameplayId))
    .sort()
    .map((gameplayId) => ({
      printingId: gameplayId,
      gameplayId,
      effectText: null,
      triggerText: null,
      hasStructuredEffects: true,
    }));
}

function historicalEvent(input, localDate, asOf, eventKey, timeZone) {
  return {
    ...input,
    asOf,
    data: { ...input.data, eventKey, time: { ...input.data.time, localDate, timeZone } },
  };
}

function buildArtifacts({
  identity = SC,
  asOf = "2026-08-20",
  windowStart = "2026-07-22",
  eventLocalDates = ["2026-08-18", "2026-08-19"],
  openLimitation = false,
  clockAcceptance = "accepted",
  clockEffectiveFrom = "2026-01-01",
  clockEffectiveUntil = null,
  clockStage = "swiss",
  clockTimeoutScoring = "double-loss",
  uncoveredGameplayIds = [],
} = {}) {
  const rules = buildRulesSnapshot({
    ...identity,
    asOf,
    source,
    authority: { name: "Bandai official rules", authorityId: `bandai-${identity.edition.toLowerCase()}` },
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
    asOf,
    source,
    cards: poolCards(rules.data.rulesIdentityHash),
  });
  const banlist = buildBanlistSnapshot({ ...banlistInput, ...identity, asOf, source });
  const construction = buildConstructionSnapshot({ ...constructionInput, ...identity, asOf, source });
  const candidateDeck = buildDeckSnapshot(deckInput, { asOf, source, idStem: "deck-ace-op16" });
  const opponentDeck = buildDeckSnapshot(
    { ...deckInput, name: "Teach OP16 (fixture)", leader: SECOND_LEADER },
    { asOf, source, idStem: "deck-teach-op16" },
  );

  const rows = catalogRows(uncoveredGameplayIds);
  const capability = buildCapabilitySnapshot({
    ...identity,
    asOf,
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
      definitionId: openLimitation ? "fixture-limitations-open-v1" : "fixture-limitations-v1",
      limitations: [
        {
          code: "attack-target-selection",
          evidenceLocation: "docs/simulation.md",
          affectedCapability: "battle",
          status: openLimitation ? "open" : "closed",
          blocksOfficialStrength: true,
        },
      ],
    },
  });

  const rulesRef = snapshotRef(rules);
  const clock = buildClockSnapshot({
    ...identity,
    asOf,
    source: { adapter: "fixture-clock" },
    rulesSnapshotRef: rulesRef,
    tournamentStage: clockStage,
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
    acceptance: clockAcceptance,
    effectiveFrom: clockEffectiveFrom,
    effectiveUntil: clockEffectiveUntil,
    roundTimeoutPolicy: {
      stage: clockStage,
      roundDurationMinutes: 30,
      timeoutScoring: clockTimeoutScoring,
      rulesSnapshotRef: rulesRef,
    },
  });

  const events = [
    finalizeSnapshot(
      historicalEvent({ ...eventAInput, environment: identity }, eventLocalDates[0], asOf, "fixture-full-field-a", identity.timeZone),
      "fixture-event-a",
    ),
    finalizeSnapshot(
      historicalEvent({ ...eventBInput, environment: identity }, eventLocalDates[1], asOf, "fixture-full-field-b", identity.timeZone),
      "fixture-event-b",
    ),
  ];
  const field = buildFieldSnapshot({
    events,
    identity,
    window: { startLocalDate: windowStart, asOf, timeZone: identity.timeZone },
    sourceRefs: events.map(snapshotRef),
    selectionPolicy: { id: "fixture-selection-v1" },
  });

  return {
    identity, asOf, rules, cardPool, banlist, construction,
    candidateDeck, opponentDeck, capability, clock, field, events,
  };
}

function artifactPath(root, snapshot) {
  return join(root, "data", "derived", DERIVED_DIR[snapshot.kind], `${snapshot.snapshotId}.json`);
}

function publishArtifacts(root, artifacts, extra = []) {
  for (const snapshot of [
    artifacts.rules, artifacts.cardPool, artifacts.banlist, artifacts.construction,
    artifacts.candidateDeck, artifacts.opponentDeck, artifacts.capability,
    artifacts.clock, artifacts.field, ...extra,
  ]) {
    publishImmutableArtifact(artifactPath(root, snapshot), snapshot);
  }
}

function deckEntry(deck, weight = 1) {
  return {
    deckSnapshotId: deck.snapshotId,
    contentHash: deck.contentHash,
    gameplayHash: deck.data.gameplayHash,
    weight,
  };
}

function draftFor(artifacts, overrides = {}) {
  const { identity, asOf } = artifacts;
  return {
    schemaVersion: 1,
    environmentKey: environmentKey({ ...identity, asOf }),
    kind: "official",
    edition: identity.edition,
    metagameRegion: identity.metagameRegion,
    language: identity.language,
    formatId: identity.formatId,
    asOf,
    timeZone: identity.timeZone,
    references: {
      rules: snapshotRef(artifacts.rules),
      cardPool: snapshotRef(artifacts.cardPool),
      banlist: snapshotRef(artifacts.banlist),
      constructionPolicy: snapshotRef(artifacts.construction),
      simulationCapability: snapshotRef(artifacts.capability),
      field: snapshotRef(artifacts.field),
      market: [],
    },
    opponents: [
      { archetypeId: "leader:OP16-001", representativeDecks: [deckEntry(artifacts.candidateDeck)] },
      { archetypeId: `leader:${SECOND_LEADER}`, representativeDecks: [deckEntry(artifacts.opponentDeck)] },
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
        clockModelRef: snapshotRef(artifacts.clock),
      },
    },
    latestPolicy: { fieldMaxAgeDays: 30, marketMaxAgeDays: 7, marketStalenessBlocksStrength: false },
    ...overrides,
  };
}

function observedMatchup(artifacts, { identity = artifacts.identity, overrides = {}, idStem = "matchup-sc-observed" } = {}) {
  const cell = (candidate, opponent, seat, extra = {}) => ({
    candidateDeckSnapshotId: candidate.snapshotId,
    candidateContentHash: candidate.contentHash,
    candidateGameplayHash: candidate.data.gameplayHash,
    opponentDeckSnapshotId: opponent.snapshotId,
    opponentContentHash: opponent.contentHash,
    opponentGameplayHash: opponent.data.gameplayHash,
    candidateSeat: seat,
    wins: 110,
    losses: 88,
    scoredRoundTimeouts: 2,
    validGames: 200,
    ...extra,
  });
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "matchup",
      environment: identity,
      asOf: artifacts.asOf,
      source: { provider: "fixture", surface: "matchup", sourceRef: { fixtureId: idStem } },
      coverage: { status: "complete", warnings: [], missingFields: [] },
      data: {
        method: "observed",
        applicability: identity.edition === artifacts.identity.edition ? "native" : "proxy",
        population: "SC Swiss fixture population",
        window: { startLocalDate: "2026-07-01", asOf: artifacts.asOf, timeZone: identity.timeZone },
        roundPolicy: { stage: "swiss", roundDurationMinutes: 30, timeoutScoring: "double-loss" },
        cells: [
          cell(artifacts.candidateDeck, artifacts.candidateDeck, "play"),
          cell(artifacts.candidateDeck, artifacts.candidateDeck, "draw"),
          cell(artifacts.candidateDeck, artifacts.opponentDeck, "play"),
          cell(artifacts.candidateDeck, artifacts.opponentDeck, "draw"),
        ],
        ...overrides,
      },
    },
    idStem,
  );
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "environment-resolver-test-"));
}

function withRoot(run) {
  const root = makeRoot();
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// One published official SC environment, aliased at SC/latest.
function setup(root, options = {}) {
  const artifacts = buildArtifacts(options.artifacts);
  publishArtifacts(root, artifacts, options.extra ?? []);
  const draft = draftFor(artifacts, options.draft ?? {});
  if (options.mutateDraft) options.mutateDraft(draft, artifacts);
  const manifest = buildManifest(draft, { root });
  if (options.alias !== null) {
    publishManifest({
      root,
      manifest,
      alias: options.alias ?? "SC/latest",
      updatedAt: options.updatedAt ?? "2026-08-21T09:00:00+08:00",
    });
  } else {
    publishManifest({ root, manifest, updatedAt: options.updatedAt ?? "2026-08-21T09:00:00+08:00" });
  }
  return { artifacts, manifest };
}

function resolve(root, input = {}, { artifacts, manifest } = {}) {
  return resolveEnvironment(
    {
      selector: "SC/latest",
      candidateDeckRef: artifacts ? snapshotRef(artifacts.candidateDeck) : input.candidateDeckRef,
      now: NOW,
      ...input,
    },
    { root },
  );
}

function failure(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentError) return resolverErrorJson(error);
    throw error;
  }
  throw new assert.AssertionError({ message: "expected an EnvironmentError but none was thrown" });
}

function resignManifest(manifest, mutate) {
  const draft = structuredClone(manifest);
  delete draft.manifestId;
  delete draft.contentHash;
  mutate(draft);
  const contentHash = hashProjection(draft, []);
  return {
    ...draft,
    manifestId: `${manifest.manifestId.slice(0, -16)}${contentHash.slice(7, 23)}`,
    contentHash,
  };
}

// Writes a hand-forged Manifest straight to the repository, standing in for
// one published by an older or defective builder.
function forceManifest(root, manifest, alias = "SC/latest") {
  writeFileSync(
    join(root, "data", "environments", `${manifest.manifestId}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (alias) {
    writeFileSync(
      join(root, "data", "environment-aliases", alias.split("/")[0], "latest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        alias,
        manifestId: manifest.manifestId,
        manifestHash: manifest.contentHash,
        updatedAt: "2026-08-21T09:30:00+08:00",
      }, null, 2)}\n`,
    );
  }
  return manifest;
}

function treeDigest(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else entries.push([relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex")]);
    }
  };
  walk(root);
  return JSON.stringify(entries);
}

/* ------------------------------------------------------------------ *
 * Happy path and returned boundary
 * ------------------------------------------------------------------ */

test("an official SC environment resolves to the concrete simulation boundary", () => {
  withRoot((root) => {
    const context = setup(root);
    const resolved = resolve(root, {}, context);

    assert.equal(resolved.schemaVersion, 1);
    assert.equal(resolved.requestedEnvironment, "SC/latest");
    assert.equal(resolved.environmentKey, "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20");
    assert.deepEqual(resolved.manifestRef, {
      manifestId: context.manifest.manifestId,
      contentHash: context.manifest.contentHash,
    });
    assert.deepEqual(resolved.candidateDeckRef, snapshotRef(context.artifacts.candidateDeck));
    assert.equal(resolved.candidateGameplayHash, context.artifacts.candidateDeck.data.gameplayHash);
    assert.equal(resolved.evaluationMode, "official");
    assert.deepEqual(resolved.turnOrderWeights, { play: 0.5, draw: 0.5 });
    assert.equal(resolved.minimumCompletedGamesPerSeat, 200);
    assert.equal(resolved.matchupEvidence.method, "simulated");
    assert.equal(resolved.matchupEvidence.applicability, "native");
    assert.deepEqual(resolved.matchupEvidence.refs, []);
    assert.deepEqual(resolved.capabilityRef, snapshotRef(context.artifacts.capability));
    assert.deepEqual(resolved.clockRef, snapshotRef(context.artifacts.clock));
    assert.deepEqual(resolved.marketRefs, []);
    assert.deepEqual(resolved.blockers, []);
    assert.deepEqual(resolved.warnings, []);
    assert.equal(resolved.roundTimeoutPolicy.timeoutScoring, "double-loss");

    assert.deepEqual(resolved.strata, [
      {
        archetypeId: "leader:OP16-001",
        fieldWeight: 5 / 12,
        representatives: [{
          deckRef: snapshotRef(context.artifacts.candidateDeck),
          gameplayHash: context.artifacts.candidateDeck.data.gameplayHash,
          withinArchetypeWeight: 1,
        }],
      },
      {
        archetypeId: "leader:OP16-080",
        fieldWeight: 7 / 12,
        representatives: [{
          deckRef: snapshotRef(context.artifacts.opponentDeck),
          gameplayHash: context.artifacts.opponentDeck.data.gameplayHash,
          withinArchetypeWeight: 1,
        }],
      },
    ]);
    assert.equal(resolved.strata.reduce((sum, row) => sum + row.fieldWeight, 0), 1);
  });
});

test("direct resolution by immutable manifestId plus full hash reaches the same plan", () => {
  withRoot((root) => {
    const context = setup(root);
    const viaAlias = resolve(root, {}, context);
    const direct = resolve(root, {
      selector: { manifestId: context.manifest.manifestId, contentHash: context.manifest.contentHash },
    }, context);

    assert.equal(direct.requestedEnvironment, context.manifest.manifestId);
    assert.deepEqual(direct.strata, viaAlias.strata);
    assert.deepEqual(direct.manifestRef, viaAlias.manifestRef);
  });
});

test("the resolver publishes and mutates nothing, on success or failure", () => {
  withRoot((root) => {
    const context = setup(root);
    const before = treeDigest(root);

    resolve(root, {}, context);
    assert.equal(treeDigest(root), before);

    failure(() => resolve(root, { selector: "EN/latest" }, context));
    assert.equal(treeDigest(root), before);
  });
});

/* ------------------------------------------------------------------ *
 * Stage 1: selector
 * ------------------------------------------------------------------ */

test("stage selector: a logical environmentKey is never a selector", () => {
  withRoot((root) => {
    const context = setup(root);
    const error = failure(() => resolve(root, {
      selector: "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20",
    }, context));

    assert.equal(error.status, "error");
    assert.equal(error.code, "environment_not_found");
    assert.equal(error.stage, "selector");
    assert.equal(failure(() => resolve(root, {
      selector: { environmentKey: "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20" },
    }, context)).code, "environment_not_found");
  });
});

test("stage selector: a manifestId without its full content hash is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const error = failure(() => resolve(root, {
      selector: { manifestId: context.manifest.manifestId },
    }, context));

    assert.equal(error.stage, "selector");
    assert.equal(error.code, "resolver_input_invalid");
    assert.equal(failure(() => resolve(root, {
      selector: { manifestId: context.manifest.manifestId, contentHash: HASH_A },
    }, context)).code, "snapshot_hash_mismatch");
  });
});

test("stage selector: unregistered aliases, missing aliases, and hostile names fail closed", () => {
  withRoot((root) => {
    const context = setup(root);
    for (const selector of ["JP/latest", "SC/../../etc/passwd", "SC/stable", "sc/latest"]) {
      const error = failure(() => resolve(root, { selector }, context));
      assert.equal(error.stage, "selector", `selector ${selector}`);
      assert.equal(error.code, "environment_not_found", `selector ${selector}`);
    }
    const unpublished = failure(() => resolve(root, { selector: "EN/latest" }, context));
    assert.equal(unpublished.code, "environment_not_found");
    assert.equal(unpublished.stage, "selector");
  });
});

test("stage selector: the injected clock and a well-formed candidate ref are required inputs", () => {
  withRoot((root) => {
    const context = setup(root);

    assert.equal(failure(() => resolveEnvironment({
      selector: "SC/latest",
      candidateDeckRef: snapshotRef(context.artifacts.candidateDeck),
    }, { root })).code, "resolver_input_invalid");
    assert.equal(failure(() => resolveEnvironment({
      selector: "SC/latest",
      candidateDeckRef: snapshotRef(context.artifacts.candidateDeck),
      now: "2026-08-21",
    }, { root })).code, "resolver_input_invalid");
    assert.equal(failure(() => resolve(root, { candidateDeckRef: { snapshotId: "x" } }, context)).code, "resolver_input_invalid");
    assert.equal(failure(() => resolve(root, { candidateDeckRef: "deck-ace-op16" }, context)).code, "resolver_input_invalid");
    // Field-for-field valid, but not a plain JSON object: only the shape guard
    // itself can refuse this one.
    class ForeignRef {
      constructor(ref) {
        this.snapshotId = ref.snapshotId;
        this.contentHash = ref.contentHash;
      }
    }
    assert.equal(
      failure(() => resolve(root, {
        candidateDeckRef: new ForeignRef(snapshotRef(context.artifacts.candidateDeck)),
      }, context)).code,
      "resolver_input_invalid",
    );
    assert.equal(failure(() => resolveEnvironment({
      selector: "SC/latest",
      candidateDeckRef: snapshotRef(context.artifacts.candidateDeck),
      now: NOW,
      unexpected: true,
    }, { root })).code, "resolver_input_invalid");
  });
});

test("stage selector: the { alias } object form resolves exactly like the string form", () => {
  withRoot((root) => {
    const context = setup(root);
    const viaString = resolve(root, { selector: "SC/latest" }, context);
    const viaObject = resolve(root, { selector: { alias: "SC/latest" } }, context);

    assert.equal(viaObject.requestedEnvironment, "SC/latest");
    assert.deepEqual(viaObject.manifestRef, viaString.manifestRef);
    assert.deepEqual(viaObject.strata, viaString.strata);
    assert.equal(failure(() => resolve(root, { selector: { alias: "JP/latest" } }, context)).code, "environment_not_found");
  });
});

test("stage selector: every field of a mutable alias record is verified", () => {
  const aliasFile = (root) => join(root, "data", "environment-aliases", "SC", "latest.json");
  const honest = (manifest) => ({
    schemaVersion: 1,
    alias: "SC/latest",
    manifestId: manifest.manifestId,
    manifestHash: manifest.contentHash,
    updatedAt: "2026-08-21T09:30:00+08:00",
  });
  // The alias is the design's ONLY mutable artifact, so every field of it is a
  // trust boundary. Each case leaves the other fields honest, so exactly one
  // guard can be responsible.
  const cases = [
    ["unsupported schema", (record) => ({ ...record, schemaVersion: 2 })],
    ["record that does not name its own alias", (record) => ({ ...record, alias: "EN/latest" })],
    ["alias naming no channel", (record) => ({ ...record, alias: "SC" })],
    ["unsafe manifestId", (record) => ({ ...record, manifestId: "../../etc/passwd" })],
    ["manifestId without a hash suffix", (record) => ({ ...record, manifestId: "SC-CN-zh-Hans" })],
    ["truncated manifest hash", (record) => ({ ...record, manifestHash: "sha256:abc" })],
    ["missing updatedAt", (record) => {
      const copy = { ...record };
      delete copy.updatedAt;
      return copy;
    }],
    ["date-only updatedAt", (record) => ({ ...record, updatedAt: "2026-08-21" })],
    ["record that is not an object", () => ["SC/latest"]],
  ];
  for (const [label, mutate] of cases) {
    withRoot((root) => {
      const context = setup(root);
      writeFileSync(aliasFile(root), `${JSON.stringify(mutate(honest(context.manifest)), null, 2)}\n`);

      const error = failure(() => resolve(root, {}, context));
      assert.equal(error.stage, "selector", label);
      assert.equal(error.code, "environment_not_found", label);
    });
  }

  // Control: the honest record resolves, so the cases above fail for their own
  // reason and not because the fixture was broken to begin with.
  withRoot((root) => {
    const context = setup(root);
    writeFileSync(aliasFile(root), `${JSON.stringify(honest(context.manifest), null, 2)}\n`);
    assert.equal(resolve(root, {}, context).evaluationMode, "official");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 2: Manifest hash
 * ------------------------------------------------------------------ */

test("stage manifest: a Manifest whose content no longer matches its hash is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const target = join(root, "data", "environments", `${context.manifest.manifestId}.json`);
    const tampered = { ...JSON.parse(readFileSync(target, "utf8")), asOf: "2026-08-19" };
    writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`);

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "manifest");
    assert.equal(error.code, "snapshot_hash_mismatch");
  });
});

test("stage manifest: a re-signed Manifest that lowers the sample floor is still refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const lowered = resignManifest(context.manifest, (draft) => {
      draft.matchupPolicy.minimumGamesPerSeat = 10;
    });
    forceManifest(root, lowered);

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "manifest");
    assert.equal(error.code, "manifest_invalid");
  });
});

test("stage manifest: a Manifest filed under another Manifest's identifier is a collision", () => {
  withRoot((root) => {
    const context = setup(root);
    // A different, entirely valid Manifest written at the requested one's path:
    // it verifies on its own terms, so only the identifier comparison sees it.
    const other = buildManifest(
      draftFor(context.artifacts, {
        latestPolicy: { fieldMaxAgeDays: 21, marketMaxAgeDays: 7, marketStalenessBlocksStrength: false },
      }),
      { root },
    );
    assert.notEqual(other.manifestId, context.manifest.manifestId);
    writeFileSync(
      join(root, "data", "environments", `${context.manifest.manifestId}.json`),
      `${JSON.stringify(other, null, 2)}\n`,
    );

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "manifest");
    assert.equal(error.code, "snapshot_id_collision");
  });
});

test("stage manifest: an alias record that does not identify its Manifest is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    writeFileSync(
      join(root, "data", "environment-aliases", "SC", "latest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        alias: "SC/latest",
        manifestId: context.manifest.manifestId,
        manifestHash: HASH_B,
        updatedAt: "2026-08-21T09:30:00+08:00",
      }, null, 2)}\n`,
    );

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.code, "snapshot_hash_mismatch");
    assert.equal(error.stage, "manifest");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 3: native identity
 * ------------------------------------------------------------------ */

test("stage identity: SC/latest cannot point at an EN Manifest", () => {
  withRoot((root) => {
    const scContext = setup(root);
    const enArtifacts = buildArtifacts({ identity: EN });
    publishArtifacts(root, enArtifacts);
    const enManifest = buildManifest(draftFor(enArtifacts), { root });
    forceManifest(root, JSON.parse(JSON.stringify(enManifest)));

    const error = failure(() => resolve(root, {}, scContext));
    assert.equal(error.stage, "identity");
    assert.equal(error.code, "environment_identity_mismatch");
  });
});

test("stage identity: a proxy Manifest cannot be served through the official SC alias", () => {
  withRoot((root) => {
    const context = setup(root);
    const proxied = resignManifest(context.manifest, (draft) => {
      draft.kind = "proxy";
      draft.matchupPolicy.proxyPriorRef = {
        snapshotId: "matchup-en-prior-0123456789abcdef",
        contentHash: HASH_A,
        originEdition: "EN",
        originEnvironmentKey: environmentKey({ ...EN, asOf: "2026-08-20" }),
      };
    });
    forceManifest(root, proxied);

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "identity");
    assert.equal(error.code, "environment_identity_mismatch");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 4: asOf and freshness
 * ------------------------------------------------------------------ */

test("stage freshness: a stale latest alias fails while the same historical Manifest still resolves directly", () => {
  withRoot((root) => {
    const context = setup(root, {
      artifacts: {
        asOf: "2026-06-01",
        windowStart: "2026-05-02",
        eventLocalDates: ["2026-05-20", "2026-05-21"],
      },
    });

    const stale = failure(() => resolveEnvironment({
      selector: "SC/latest",
      candidateDeckRef: snapshotRef(context.artifacts.candidateDeck),
      now: NOW,
    }, { root }));
    assert.equal(stale.stage, "freshness");
    assert.equal(stale.code, "stale_latest");
    assert.equal(stale.details.fieldMaxAgeDays, 30);

    const historical = resolveEnvironment({
      selector: { manifestId: context.manifest.manifestId, contentHash: context.manifest.contentHash },
      candidateDeckRef: snapshotRef(context.artifacts.candidateDeck),
      now: NOW,
    }, { root });
    assert.equal(historical.evaluationMode, "official");
    assert.equal(historical.environmentKey.endsWith(":2026-06-01"), true);
  });
});

test("stage freshness: the default latest policy is 30 days of field evidence", () => {
  withRoot((root) => {
    const context = setup(root);

    assert.equal(resolve(root, { now: "2026-09-19T23:00:00+08:00" }, context).evaluationMode, "official");
    const justStale = failure(() => resolve(root, { now: "2026-09-20T00:30:00+08:00" }, context));
    assert.equal(justStale.code, "stale_latest");
    assert.equal(justStale.stage, "freshness");
  });
});

test("stage freshness: an asOf later than the injected clock is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const error = failure(() => resolve(root, { now: "2026-08-19T10:00:00+08:00" }, context));

    assert.equal(error.stage, "freshness");
    assert.equal(error.code, "environment_identity_mismatch");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 5: rules / card pool / banlist / construction references
 * ------------------------------------------------------------------ */

test("stage references: an artifact that no longer matches its pinned hash is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const impostor = buildRulesSnapshot({
      ...SC,
      asOf: "2026-08-20",
      source,
      authority: { name: "Impostor", authorityId: "impostor" },
      documentRefs: [{ documentId: "comprehensive-rules", version: "9.9.9", sourceHash: HASH_A }],
      effectiveFrom: "2026-04-01",
      effectiveUntil: null,
      sourceHashes: [HASH_A],
    });
    const target = artifactPath(root, context.artifacts.rules);
    unlinkSync(target);
    writeFileSync(target, `${JSON.stringify(impostor, null, 2)}\n`);

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "references");
    assert.equal(error.code, "snapshot_hash_mismatch");
    assert.equal(error.path, "references.rules");
  });
});

test("stage references: identical content filed under another identifier is a collision", () => {
  withRoot((root) => {
    const context = setup(root);
    // Same content, different id stem: the content hash still matches, so only
    // the identifier check can see that the repository has it in the wrong place.
    const misfiled = buildRulesSnapshot({
      ...SC,
      asOf: "2026-08-20",
      source,
      authority: { name: "Bandai official rules", authorityId: "bandai-sc" },
      documentRefs: [
        { documentId: "comprehensive-rules", version: "1.2.0", sourceHash: HASH_B },
        { documentId: "tournament-rules", version: "1.6.0", sourceHash: HASH_A },
      ],
      effectiveFrom: "2026-04-01",
      effectiveUntil: null,
      sourceHashes: [HASH_B, HASH_A],
      idStem: "sc-rules-alternate-stem",
    });
    assert.equal(misfiled.contentHash, context.artifacts.rules.contentHash);
    assert.notEqual(misfiled.snapshotId, context.artifacts.rules.snapshotId);
    const target = artifactPath(root, context.artifacts.rules);
    unlinkSync(target);
    writeFileSync(target, `${JSON.stringify(misfiled, null, 2)}\n`);

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "references");
    assert.equal(error.code, "snapshot_id_collision");
    assert.equal(error.path, "references.rules");
  });
});

test("stage references: a deleted rules artifact is not found", () => {
  withRoot((root) => {
    const context = setup(root);
    unlinkSync(artifactPath(root, context.artifacts.cardPool));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "references");
    assert.equal(error.code, "environment_not_found");
    assert.equal(error.path, "references.cardPool");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 6: candidate and representative decks
 * ------------------------------------------------------------------ */

test("stage decks: an illegal candidate deck stops the resolution", () => {
  withRoot((root) => {
    const context = setup(root);
    const shortDeck = buildDeckSnapshot(
      { ...deckInput, main: deckInput.main.slice(0, 49) },
      { asOf: "2026-08-20", source, idStem: "deck-short" },
    );
    publishImmutableArtifact(artifactPath(root, shortDeck), shortDeck);

    const error = failure(() => resolve(root, { candidateDeckRef: snapshotRef(shortDeck) }, context));
    assert.equal(error.stage, "decks");
    assert.equal(error.code, "illegal_deck");
    assert.equal(error.path, "candidateDeckRef");
  });
});

test("stage decks: a banned card in the candidate deck is an illegal deck", () => {
  withRoot((root) => {
    const context = setup(root);
    const bannedDeck = buildDeckSnapshot(
      { ...deckInput, main: [...deckInput.main.slice(0, 49), "OP06-086"] },
      { asOf: "2026-08-20", source, idStem: "deck-banned" },
    );
    publishImmutableArtifact(artifactPath(root, bannedDeck), bannedDeck);

    const error = failure(() => resolve(root, { candidateDeckRef: snapshotRef(bannedDeck) }, context));
    assert.equal(error.stage, "decks");
    assert.equal(error.code, "illegal_deck");
  });
});

test("stage decks: a representative deck that disappeared after publication is reported", () => {
  withRoot((root) => {
    const context = setup(root);
    unlinkSync(artifactPath(root, context.artifacts.opponentDeck));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "decks");
    assert.equal(error.code, "missing_representative_deck");
  });
});

test("stage decks: a representative deck's pinned gameplay hash is rechecked at resolve", () => {
  withRoot((root) => {
    const context = setup(root);
    // buildManifest pins this too; the resolver keeps its own copy for a
    // Manifest that reached the repository some other way.
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.opponents[1].representativeDecks[0].gameplayHash = HASH_B;
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "decks");
    assert.equal(error.code, "illegal_deck");
    assert.equal(error.path, "opponents[1].representativeDecks[0]");
  });
});

test("stage decks: an illegal REPRESENTATIVE deck is reported against its own position", () => {
  withRoot((root) => {
    const context = setup(root);
    const shortDeck = buildDeckSnapshot(
      { ...deckInput, name: "Short representative", main: deckInput.main.slice(0, 49) },
      { asOf: "2026-08-20", source, idStem: "deck-short-representative" },
    );
    publishImmutableArtifact(artifactPath(root, shortDeck), shortDeck);
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.opponents[0].representativeDecks[0] = {
        deckSnapshotId: shortDeck.snapshotId,
        contentHash: shortDeck.contentHash,
        gameplayHash: shortDeck.data.gameplayHash,
        weight: 1,
      };
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "decks");
    assert.equal(error.code, "illegal_deck");
    // The stamp must name the representative, not the candidate.
    assert.equal(error.path, "opponents[0].representativeDecks[0]");
  });
});

test("stage decks: a candidate that is not a DeckSnapshot is refused", () => {
  withRoot((root) => {
    const context = setup(root);
    const error = failure(() => resolve(root, {
      candidateDeckRef: snapshotRef(context.artifacts.field),
    }, context));

    assert.equal(error.stage, "decks");
    assert.equal(error.code, "environment_not_found");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 7: field completeness
 * ------------------------------------------------------------------ */

function forgeField(artifacts, mutate, idStem = "field-forged") {
  const draft = {
    schemaVersion: 1,
    kind: "field",
    environment: artifacts.identity,
    asOf: artifacts.field.asOf,
    source: structuredClone(artifacts.field.source),
    coverage: structuredClone(artifacts.field.coverage),
    data: structuredClone(artifacts.field.data),
  };
  mutate(draft);
  return finalizeSnapshot(draft, idStem);
}

function withForgedField(root, forge) {
  const artifacts = buildArtifacts();
  const forged = forge(artifacts);
  publishArtifacts(root, artifacts, [forged]);
  const draft = draftFor(artifacts);
  draft.references.field = snapshotRef(forged);
  const manifest = buildManifest(draft, { root });
  publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });
  return { artifacts, manifest };
}

test("stage field: unclassified participants make the field unrepresentative", () => {
  withRoot((root) => {
    // Internally CONSISTENT but incomplete: 10 classified + 2 unclassified = 12
    // total, all 12 covered. Only the unclassified guard can see this, so the
    // assertion pins which guard fired rather than merely that one did.
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.classifiedParticipants = 10;
      draft.data.unclassifiedParticipants = 2;
      draft.data.coveredParticipants = 12;
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "field_not_representative");
    assert.equal(error.details.reason, "unclassified_participants");
    assert.equal(error.details.unclassifiedParticipants, 2);
  });
});

test("stage field: incomplete field coverage status is refused", () => {
  withRoot((root) => {
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.coverage.status = "partial";
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "field_not_representative");
  });
});

test("stage field: a repeated event key is a duplicate event", () => {
  withRoot((root) => {
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.selectedEvents = [draft.data.selectedEvents[0], { ...draft.data.selectedEvents[1], eventKey: draft.data.selectedEvents[0].eventKey }];
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "duplicate_event");
  });
});

test("stage field: a field archetype with no representative deck is reported", () => {
  withRoot((root) => {
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.archetypes = [
        { archetypeId: "leader:OP16-001", players: 5, share: 5 / 12 },
        { archetypeId: "leader:OP16-080", players: 6, share: 6 / 12 },
        { archetypeId: "leader:OP16-777", players: 1, share: 1 / 12 },
      ];
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "missing_representative_deck");
  });
});

test("stage field: a field dated differently from the Manifest asOf is refused", () => {
  withRoot((root) => {
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.window = { ...draft.data.window, asOf: "2026-08-19" };
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "environment_identity_mismatch");
    assert.equal(error.details.reason, "field_as_of_mismatch");
  });
});

test("stage field: a field window stated in another timezone is refused", () => {
  withRoot((root) => {
    // Correctly dated, so only the window-timezone assertion can see it. This
    // is the guard that keeps a proxy Manifest from borrowing a cross-edition
    // field through its window.
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.window = { ...draft.data.window, timeZone: "Asia/Tokyo" };
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "environment_identity_mismatch");
    assert.equal(error.details.reason, "field_window_timezone_mismatch");
    assert.equal(error.details.windowTimeZone, "Asia/Tokyo");
  });
});

test("stage field: legacy evidence never becomes field evidence, even when re-signed in", () => {
  withRoot((root) => {
    const context = setup(root);
    const legacy = forgeField(context.artifacts, (draft) => {
      draft.source = { ...draft.source, evidenceStatus: "legacy_unverified" };
    }, "field-legacy");
    publishImmutableArtifact(artifactPath(root, legacy), legacy);

    // buildManifest already refuses this artifact, so the only way to reach the
    // resolver's own guard is a hand-signed Manifest -- exactly the "published
    // by an older builder" case the resolver must still fail closed on.
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.references.field = { snapshotId: legacy.snapshotId, contentHash: legacy.contentHash };
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "field");
    assert.equal(error.code, "legacy_evidence_rejected");
  });
});

test("buildManifest is the first line of defence against legacy field evidence", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const legacy = forgeField(artifacts, (draft) => {
      draft.source = { ...draft.source, evidenceStatus: "legacy_unverified" };
    }, "field-legacy");
    publishArtifacts(root, artifacts, [legacy]);
    const draft = draftFor(artifacts);
    draft.references.field = snapshotRef(legacy);

    const error = failure(() => buildManifest(draft, { root }));
    assert.equal(error.code, "legacy_evidence_rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 8: observed and proxy evidence
 * ------------------------------------------------------------------ */

test("stage evidence: observed mode validates scoreable cells and emits no simulation jobs", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const matchup = observedMatchup(artifacts);
    publishArtifacts(root, artifacts, [matchup]);
    const draft = draftFor(artifacts);
    draft.matchupPolicy.mode = "observed";
    draft.matchupPolicy.observedMatchupRefs = [snapshotRef(matchup)];
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const resolved = resolve(root, {}, { artifacts, manifest });
    assert.equal(resolved.matchupEvidence.method, "observed");
    assert.equal(resolved.matchupEvidence.applicability, "native");
    assert.deepEqual(resolved.matchupEvidence.refs, [snapshotRef(matchup)]);
    assert.equal(Object.hasOwn(resolved, "jobs"), false);
    assert.equal(Object.hasOwn(resolved, "simulationJobs"), false);
  });
});

test("stage evidence: observed cells without counts or seat splits are insufficient", () => {
  const cases = [
    ["missing counts", "missing_outcome_counts", (cells) => cells.map((cell) => {
      const copy = { ...cell };
      delete copy.validGames;
      return copy;
    })],
    ["inconsistent arithmetic", "outcome_counts_inconsistent", (cells) => cells.map((cell) => ({ ...cell, wins: 1 }))],
    ["below the per-seat floor", "below_per_seat_floor", (cells) => cells.map((cell) => ({ ...cell, wins: 10, losses: 9, scoredRoundTimeouts: 1, validGames: 20 }))],
    ["one seat only", "incomplete_seat_coverage", (cells) => cells.filter((cell) => cell.candidateSeat === "play")],
    ["no seat at all", "missing_seat", (cells) => cells.map((cell) => ({ ...cell, candidateSeat: "either" }))],
  ];
  for (const [label, reason, mutate] of cases) {
    withRoot((root) => {
      const artifacts = buildArtifacts();
      const healthy = observedMatchup(artifacts);
      const broken = observedMatchup(artifacts, {
        overrides: { cells: mutate(structuredClone(healthy.data.cells)) },
        idStem: "matchup-sc-broken",
      });
      publishArtifacts(root, artifacts, [broken]);
      const draft = draftFor(artifacts);
      draft.matchupPolicy.mode = "observed";
      draft.matchupPolicy.observedMatchupRefs = [snapshotRef(broken)];
      const manifest = buildManifest(draft, { root });
      publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

      const error = failure(() => resolve(root, {}, { artifacts, manifest }));
      assert.equal(error.stage, "evidence", label);
      assert.equal(error.code, "insufficient_matchup_coverage", label);
      // Each defect must be attributable to its own guard, or one broad check
      // would silently stand in for all of them.
      assert.equal(error.details.reason, reason, label);
    });
  }
});

test("stage evidence: observed mode requires at least one immutable matchup reference", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const draft = draftFor(artifacts);
    draft.matchupPolicy.mode = "observed";
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const error = failure(() => resolve(root, {}, { artifacts, manifest }));
    assert.equal(error.stage, "evidence");
    assert.equal(error.code, "insufficient_matchup_coverage");
  });
});

test("stage evidence: cells belonging to a different candidate never count as coverage", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    // Every cell is individually valid, but its CANDIDATE is the opponent deck,
    // not the deck being resolved. Counting these would report full coverage
    // for a candidate that was never played.
    const foreign = observedMatchup(artifacts, {
      idStem: "matchup-sc-foreign-candidate",
      overrides: {
        cells: observedMatchup(artifacts).data.cells.map((cell) => ({
          ...cell,
          candidateDeckSnapshotId: artifacts.opponentDeck.snapshotId,
          candidateContentHash: artifacts.opponentDeck.contentHash,
          candidateGameplayHash: artifacts.opponentDeck.data.gameplayHash,
        })),
      },
    });
    publishArtifacts(root, artifacts, [foreign]);
    const draft = draftFor(artifacts);
    draft.matchupPolicy.mode = "observed";
    draft.matchupPolicy.observedMatchupRefs = [snapshotRef(foreign)];
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const error = failure(() => resolve(root, {}, { artifacts, manifest }));
    assert.equal(error.stage, "evidence");
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "incomplete_seat_coverage");
  });
});

test("stage evidence: observed evidence must agree with the Manifest round policy", () => {
  for (const [label, roundPolicy] of [
    ["stage", { stage: "top-cut", roundDurationMinutes: 30, timeoutScoring: "double-loss" }],
    ["duration", { stage: "swiss", roundDurationMinutes: 45, timeoutScoring: "double-loss" }],
    ["timeout scoring", { stage: "swiss", roundDurationMinutes: 30, timeoutScoring: "extra-turns" }],
  ]) {
    withRoot((root) => {
      const artifacts = buildArtifacts();
      const mismatched = observedMatchup(artifacts, {
        idStem: `matchup-sc-round-${label.replace(/\s+/g, "-")}`,
        overrides: { roundPolicy },
      });
      publishArtifacts(root, artifacts, [mismatched]);
      const draft = draftFor(artifacts);
      draft.matchupPolicy.mode = "observed";
      draft.matchupPolicy.observedMatchupRefs = [snapshotRef(mismatched)];
      const manifest = buildManifest(draft, { root });
      publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

      const error = failure(() => resolve(root, {}, { artifacts, manifest }));
      assert.equal(error.stage, "evidence", label);
      assert.equal(error.code, "insufficient_matchup_coverage", label);
    });
  }
});

test("stage evidence: an explicit proxy environment resolves with proxy applicability", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const prior = observedMatchup(artifacts, { identity: EN, idStem: "matchup-en-prior" });
    publishArtifacts(root, artifacts, [prior]);
    const draft = draftFor(artifacts, { kind: "proxy" });
    draft.matchupPolicy.proxyPriorRef = {
      snapshotId: prior.snapshotId,
      contentHash: prior.contentHash,
      originEdition: "EN",
      originEnvironmentKey: environmentKey({ ...EN, asOf: "2026-08-20" }),
    };
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC_WITH_EN_PRIOR/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const resolved = resolveEnvironment({
      selector: "SC_WITH_EN_PRIOR/latest",
      candidateDeckRef: snapshotRef(artifacts.candidateDeck),
      now: NOW,
    }, { root });

    assert.equal(resolved.evaluationMode, "proxy");
    assert.equal(resolved.matchupEvidence.applicability, "proxy");
    assert.deepEqual(resolved.matchupEvidence.refs, [{ snapshotId: prior.snapshotId, contentHash: prior.contentHash }]);
    assert.equal(resolved.requestedEnvironment, "SC_WITH_EN_PRIOR/latest");
  });
});

test("stage evidence: a proxy prior that fails the scoreable-cell contract is refused", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const prior = observedMatchup(artifacts, {
      identity: EN,
      idStem: "matchup-en-prior-broken",
      overrides: { cells: [] },
    });
    publishArtifacts(root, artifacts, [prior]);
    const draft = draftFor(artifacts, { kind: "proxy" });
    draft.matchupPolicy.proxyPriorRef = {
      snapshotId: prior.snapshotId,
      contentHash: prior.contentHash,
      originEdition: "EN",
      originEnvironmentKey: environmentKey({ ...EN, asOf: "2026-08-20" }),
    };
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC_WITH_EN_PRIOR/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const error = failure(() => resolveEnvironment({
      selector: "SC_WITH_EN_PRIOR/latest",
      candidateDeckRef: snapshotRef(artifacts.candidateDeck),
      now: NOW,
    }, { root }));
    assert.equal(error.stage, "evidence");
    assert.equal(error.code, "insufficient_matchup_coverage");
    assert.equal(error.details.reason, "no_scoreable_cells");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 9: capability gate
 * ------------------------------------------------------------------ */

test("stage capability: a deck card the engine cannot execute is never diagnostic-ready", () => {
  withRoot((root) => {
    const context = setup(root, { artifacts: { uncoveredGameplayIds: ["OP16-118"] } });

    for (const allowDiagnostic of [false, true]) {
      const error = failure(() => resolve(root, { allowDiagnostic }, context));
      assert.equal(error.stage, "capability");
      assert.equal(error.code, "simulation_not_ready");
      assert.deepEqual(error.details.missing, ["OP16-118"]);
    }
  });
});

test("stage capability: an open blocker withholds official strength unless diagnostics are requested", () => {
  withRoot((root) => {
    const context = setup(root, { artifacts: { openLimitation: true } });

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "capability");
    assert.equal(error.code, "simulation_not_ready");

    const diagnostic = resolve(root, { allowDiagnostic: true }, context);
    assert.equal(diagnostic.evaluationMode, "diagnostic_estimate");
    assert.deepEqual(diagnostic.blockers.map((row) => row.code), ["attack-target-selection"]);
  });
});

test("stage capability: explicit diagnostic permission never downgrades a healthy environment", () => {
  withRoot((root) => {
    const context = setup(root);
    assert.equal(resolve(root, { allowDiagnostic: true }, context).evaluationMode, "official");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 10: clock gate
 * ------------------------------------------------------------------ */

test("stage clock: a null clock model withholds official strength unless diagnostics are requested", () => {
  withRoot((root) => {
    const context = setup(root, {
      mutateDraft: (draft) => { draft.matchupPolicy.roundPolicy.clockModelRef = null; },
    });

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "clock");
    assert.equal(error.code, "clock_model_unavailable");

    const diagnostic = resolve(root, { allowDiagnostic: true }, context);
    assert.equal(diagnostic.evaluationMode, "diagnostic_estimate");
    assert.equal(diagnostic.clockRef, null);
    assert.equal(diagnostic.roundTimeoutPolicy, null);
    assert.ok(diagnostic.blockers.some((row) => row.code === "clock_model_unavailable"));
  });
});

test("stage clock: the gate reads the injected clock, never host time", () => {
  withRoot((root) => {
    const context = setup(root, { artifacts: { clockEffectiveFrom: "2026-08-01", clockEffectiveUntil: "2026-08-20" } });

    assert.equal(resolve(root, { now: "2026-08-20T10:00:00+08:00" }, context).evaluationMode, "official");
    const expired = failure(() => resolve(root, { now: "2026-08-21T10:00:00+08:00" }, context));
    assert.equal(expired.stage, "clock");
    assert.equal(expired.code, "clock_model_unavailable");
  });
});

test("stage clock: the injected instant is compared in the environment timezone, not UTC", () => {
  withRoot((root) => {
    // One instant, two notations. 2026-08-21T00:30+08:00 and 2026-08-20T16:30Z
    // are the SAME moment, and in Asia/Shanghai both are 2026-08-21 -- after
    // the model expires at the end of 2026-08-20 local. A resolver that read
    // the UTC calendar date (or trusted the notation it happened to be given)
    // would accept the second one.
    const context = setup(root, { artifacts: { clockEffectiveFrom: "2026-08-01", clockEffectiveUntil: "2026-08-20" } });
    for (const now of ["2026-08-21T00:30:00+08:00", "2026-08-20T16:30:00Z"]) {
      const error = failure(() => resolve(root, { now }, context));
      assert.equal(error.stage, "clock", now);
      assert.equal(error.code, "clock_model_unavailable", now);
    }
    // ... and the instant one hour earlier is still inside the model.
    assert.equal(resolve(root, { now: "2026-08-20T15:30:00Z" }, context).evaluationMode, "official");
  });
});

test("stage clock: a legacy clock model is rejected outright, never degraded to diagnostic", () => {
  withRoot((root) => {
    const context = setup(root);
    const legacyClock = finalizeSnapshot(
      {
        schemaVersion: 1,
        kind: "clock-model",
        environment: SC,
        asOf: context.artifacts.clock.asOf,
        source: { ...structuredClone(context.artifacts.clock.source), evidenceStatus: "legacy_unverified" },
        coverage: structuredClone(context.artifacts.clock.coverage),
        data: structuredClone(context.artifacts.clock.data),
      },
      "clock-model-legacy",
    );
    publishImmutableArtifact(artifactPath(root, legacyClock), legacyClock);
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.matchupPolicy.roundPolicy.clockModelRef = {
        snapshotId: legacyClock.snapshotId,
        contentHash: legacyClock.contentHash,
      };
    }));

    // Even WITH diagnostic permission, which would otherwise convert a clock
    // problem into a blocker: legacy evidence is a refusal, not a degradation.
    const error = failure(() => resolve(root, { allowDiagnostic: true }, context));
    assert.equal(error.stage, "clock");
    assert.equal(error.code, "legacy_evidence_rejected");
  });
});

test("stage clock: a draft or rejected clock model can never authorize a round timeout", () => {
  for (const acceptance of ["draft", "rejected"]) {
    withRoot((root) => {
      const context = setup(root, { artifacts: { clockAcceptance: acceptance } });
      const error = failure(() => resolve(root, {}, context));

      assert.equal(error.stage, "clock", acceptance);
      assert.equal(error.code, "clock_model_unavailable", acceptance);
    });
  }
});

test("stage clock: a clock whose timeout policy disagrees with the Manifest is refused", () => {
  withRoot((root) => {
    const context = setup(root, {
      artifacts: { clockStage: "top-cut", clockTimeoutScoring: "extra-turns" },
      mutateDraft: (draft) => {
        draft.matchupPolicy.roundPolicy.stage = "top-cut";
        draft.matchupPolicy.roundPolicy.timeoutScoring = "double-loss";
      },
    });

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "clock");
    assert.equal(error.code, "clock_model_unavailable");
  });
});

/* ------------------------------------------------------------------ *
 * Stage 11: exact strata and turn-order weights
 * ------------------------------------------------------------------ */

// Fix round 1: buildManifest and publishManifest now refuse a Manifest whose
// weights cannot sum to one, so these two positions can no longer be reached by
// building one. A hand-signed file is exactly the case the resolver's plan
// stage exists for -- a Manifest that reached the repository some other way --
// so the setup switched from mutateDraft to resign + force. Nothing about what
// is asserted changed.
test("stage plan: turn-order weights must sum to exactly one", () => {
  withRoot((root) => {
    const context = setup(root);
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.matchupPolicy.turnOrderWeights = { play: 0.5, draw: 0.4 };
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "plan");
    assert.equal(error.code, "manifest_invalid");
  });
});

test("stage plan: within-archetype representative weights must sum to exactly one", () => {
  withRoot((root) => {
    const context = setup(root);
    forceManifest(root, resignManifest(context.manifest, (draft) => {
      draft.opponents[0].representativeDecks = [
        deckEntry(context.artifacts.candidateDeck, 0.5),
        deckEntry(context.artifacts.opponentDeck, 0.2),
      ];
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "plan");
    assert.equal(error.code, "manifest_invalid");
  });
});

test("stage plan: field shares that do not sum to one are refused", () => {
  withRoot((root) => {
    const context = withForgedField(root, (artifacts) => forgeField(artifacts, (draft) => {
      draft.data.archetypes = [
        { archetypeId: "leader:OP16-001", players: 5, share: 0.4 },
        { archetypeId: "leader:OP16-080", players: 7, share: 0.5 },
      ];
    }));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "plan");
    assert.equal(error.code, "field_not_representative");
  });
});

test("stage plan: multiple representatives keep their explicit within-archetype weights", () => {
  withRoot((root) => {
    const context = setup(root, {
      mutateDraft: (draft, artifacts) => {
        draft.opponents[0].representativeDecks = [
          deckEntry(artifacts.candidateDeck, 0.75),
          deckEntry(artifacts.opponentDeck, 0.25),
        ];
      },
    });
    const resolved = resolve(root, {}, context);

    assert.deepEqual(
      resolved.strata[0].representatives.map((row) => row.withinArchetypeWeight),
      [0.75, 0.25],
    );
    assert.equal(resolved.strata[0].fieldWeight, 5 / 12);
  });
});

/* ------------------------------------------------------------------ *
 * Market evidence
 * ------------------------------------------------------------------ */

function marketSnapshot(artifacts, asOf, idStem = "market-sc") {
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "market",
      environment: artifacts.identity,
      asOf,
      source: { provider: "jihuanshe", surface: "market", sourceRef: { fixtureId: idStem } },
      coverage: { status: "partial", warnings: ["visible-viewport"], missingFields: ["pagination"] },
      data: { scope: "visible-viewport", paginationComplete: false, currency: "CNY", rows: [] },
    },
    idStem,
  );
}

test("market staleness and market failure never block strength and never enter strata", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const stale = marketSnapshot(artifacts, "2026-07-01", "market-sc-stale");
    const absent = marketSnapshot(artifacts, "2026-08-20", "market-sc-absent");
    publishArtifacts(root, artifacts, [stale, absent]);
    const draft = draftFor(artifacts);
    draft.references.market = [snapshotRef(stale), snapshotRef(absent)];
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });
    unlinkSync(artifactPath(root, absent));

    const resolved = resolve(root, {}, { artifacts, manifest });
    assert.equal(resolved.evaluationMode, "official");
    assert.deepEqual(resolved.marketRefs, [snapshotRef(stale), snapshotRef(absent)]);
    assert.deepEqual(resolved.warnings.map((row) => row.code).sort(), ["market_stale", "market_unavailable"]);

    const strataText = JSON.stringify(resolved.strata);
    assert.equal(strataText.includes(stale.snapshotId), false);
    assert.equal(strataText.includes(absent.snapshotId), false);
  });
});

test("a Manifest policy that makes market staleness blocking is honoured", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const stale = marketSnapshot(artifacts, "2026-07-01", "market-sc-stale");
    publishArtifacts(root, artifacts, [stale]);
    const draft = draftFor(artifacts);
    draft.references.market = [snapshotRef(stale)];
    draft.latestPolicy.marketStalenessBlocksStrength = true;
    const manifest = buildManifest(draft, { root });
    publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" });

    const error = failure(() => resolve(root, {}, { artifacts, manifest }));
    assert.equal(error.stage, "freshness");
    assert.equal(error.code, "stale_latest");
  });
});

/* ------------------------------------------------------------------ *
 * Failure serialization
 * ------------------------------------------------------------------ */

test("resolver failures serialize with a stable code, stage, path, and safe details", () => {
  withRoot((root) => {
    const context = setup(root);
    unlinkSync(artifactPath(root, context.artifacts.cardPool));
    const error = failure(() => resolve(root, {}, context));

    assert.deepEqual(Object.keys(error).sort(), ["code", "details", "path", "stage", "status"]);
    assert.equal(error.status, "error");
    assert.equal(typeof error.code, "string");
    assert.ok(RESOLVER_STAGES.includes(error.stage));
    assert.equal(typeof error.path, "string");
    assert.equal(error.path.startsWith("/"), false);

    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes(root), false, "absolute repository paths must never be serialized");
    assert.equal(serialized.includes(tmpdir()), false);
  });
});

test("resolverErrorJson redacts repository-private filesystem paths from details", () => {
  const error = new EnvironmentError("environment_not_found", "artifact missing", {
    stage: "references",
    path: "references.rules",
    target: "/var/folders/zz/repo/data/derived/rules/sc-rules-0123456789abcdef.json",
    nested: { file: "/tmp/private/thing.json", kind: "rules" },
    list: ["/tmp/private/a.json", "leader:OP16-001"],
  });
  const json = resolverErrorJson(error);

  assert.equal(json.stage, "references");
  assert.equal(json.path, "references.rules");
  assert.equal(json.details.target, "[redacted-path]");
  assert.equal(json.details.nested.file, "[redacted-path]");
  assert.deepEqual(json.details.list, ["[redacted-path]", "leader:OP16-001"]);
  assert.equal(json.details.nested.kind, "rules");
  // stage and path are top-level contract fields, never duplicated into details.
  assert.equal(Object.hasOwn(json.details, "stage"), false);
  assert.equal(Object.hasOwn(json.details, "path"), false);

  // Defence in depth for later tasks' failures: if anything ever stamps a
  // filesystem path as the logical `path`, the contract field drops it rather
  // than publishing it.
  const leaky = resolverErrorJson(new EnvironmentError("environment_not_found", "x", {
    stage: "references",
    path: "/var/folders/zz/repo/data/derived/rules/sc-rules-0123456789abcdef.json",
  }));
  assert.equal(leaky.path, "");
  assert.equal(JSON.stringify(leaky).includes("/var/folders"), false);
});

test("an unreadable referenced artifact keeps its logical path and leaks no filesystem path", () => {
  withRoot((root) => {
    const context = setup(root);
    const target = artifactPath(root, context.artifacts.rules);
    unlinkSync(target);
    writeFileSync(target, "{ this is not json");

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "references");
    assert.equal(error.path, "references.rules");
    assert.equal(JSON.stringify(error).includes(root), false);
  });
});

test("the public barrel exports the Tasks 1-6 surface plus Task 11's three modules", async () => {
  const barrel = await import("./index.mjs");

  for (const name of [
    "EnvironmentError",
    "canonicalJson", "sha256Canonical", "hashProjection",
    "finalizeSnapshot", "verifySnapshot", "snapshotRef",
    "publishImmutableArtifact", "publishMutableRecord", "readVerifiedArtifact", "recoverStaleTemps",
    "buildDeckSnapshot", "gameplayHashForDeck",
    "buildRulesSnapshot", "buildCardPoolSnapshot", "buildBanlistSnapshot", "buildConstructionSnapshot",
    "assertNativeEnvironment", "validateDeckLegality",
    "buildCapabilitySnapshot", "evaluateCapabilityGate", "verifyCapabilitySnapshot",
    "buildClockSnapshot", "verifyClockSnapshot", "evaluateClockGate",
    "buildFieldSnapshot", "eventQualifies", "freshnessAgeDays", "localDayEnd",
    "environmentKey", "buildManifest", "verifyManifest", "manifestRef", "publishManifest",
    "parseEnvironmentSelector", "ALIAS_REGISTRY",
    "resolveEnvironment", "resolverErrorJson", "RESOLVER_STAGES", "RESOLVER_ERROR_CODES",
    // Task 11 has landed and extended this barrel, which is what the fence below was waiting for:
    // these six were a NEGATIVE list ("Task 6 must not absorb Task 11's scope") and are now a
    // positive one. Two of the original names were aspirational and never existed -- the authored
    // modules call them `buildSimulatedMatchupSnapshot` and `aggregateEnvironment` -- so the real
    // export names are asserted here rather than aliases invented to satisfy the old strings.
    "expandSimulationPlan", "buildSimulatedMatchupSnapshot", "weightedSeatEv",
    "compareVariants", "compareEnvironments", "aggregateEnvironment",
  ]) {
    assert.ok(Object.hasOwn(barrel, name), `missing public export: ${name}`);
  }

  assert.equal(barrel.resolveEnvironment, resolveEnvironment);
  assert.equal(barrel.buildManifest, buildManifest);
});

test("every stable failure code the resolver emits is declared, including resolver_failed", () => {
  for (const code of [
    "environment_not_found", "snapshot_hash_mismatch", "snapshot_id_collision",
    "environment_identity_mismatch", "stale_latest", "field_not_representative",
    "duplicate_event", "illegal_deck", "simulation_not_ready",
    "missing_representative_deck", "insufficient_matchup_coverage", "clock_model_unavailable",
    "manifest_invalid", "legacy_evidence_rejected", "resolver_input_invalid",
    "resolver_failed",
  ]) {
    assert.ok(RESOLVER_ERROR_CODES.includes(code), `undeclared stable code: ${code}`);
  }
  assert.equal(new Set(RESOLVER_ERROR_CODES).size, RESOLVER_ERROR_CODES.length);

  // resolver_failed is not decorative: a non-EnvironmentError escaping a stage
  // must still serialize as the stable contract rather than propagating untyped.
  const wrapped = resolverErrorJson(new TypeError("something unexpected"));
  assert.equal(wrapped.status, "error");
  assert.equal(wrapped.code, "resolver_failed");
  assert.ok(RESOLVER_ERROR_CODES.includes(wrapped.code));
});

test("the fixed stage order is declared and every stage is reachable", () => {
  assert.deepEqual(RESOLVER_STAGES, [
    "selector",
    "manifest",
    "identity",
    "freshness",
    "references",
    "decks",
    "field",
    "evidence",
    "capability",
    "clock",
    "plan",
  ]);
});

test("stage order is fixed: an earlier defect is reported even when a later one also exists", () => {
  withRoot((root) => {
    const context = setup(root, { artifacts: { openLimitation: true } });
    // Both the capability gate (stage 9) and the references (stage 5) are broken.
    unlinkSync(artifactPath(root, context.artifacts.banlist));

    const error = failure(() => resolve(root, {}, context));
    assert.equal(error.stage, "references");
    assert.equal(error.code, "environment_not_found");
  });
});
