import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

import {
  aliasRecordPath,
  derivedArtifactPath,
  manifestPath,
  parseEnvironmentSelector,
} from "./alias.mjs";
import {
  buildManifest,
  environmentKey,
  manifestRef,
  publishManifest,
  verifyManifest,
} from "./manifest.mjs";

/* ------------------------------------------------------------------ *
 * Deterministic synthetic environment. Every artifact below is built
 * through the real Task 1-5 builders, so every hash in this file and in
 * tests/fixtures/environment/manifest-*.json is genuine.
 * ------------------------------------------------------------------ */

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

// Independent expectation of the repository layout. alias.mjs must agree
// with this table rather than the other way round.
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

function catalogRows() {
  return [...poolInput.cards.map((card) => card.gameplayId), SECOND_LEADER]
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
    data: {
      ...input.data,
      eventKey,
      time: { ...input.data.time, localDate, timeZone },
    },
  };
}

// Builds one deterministic environment's worth of artifacts. Nothing here
// reads host time, so repeated runs produce identical IDs and hashes.
function buildArtifacts({
  identity = SC,
  asOf = "2026-08-20",
  windowStart = "2026-07-22",
  eventLocalDates = ["2026-08-18", "2026-08-19"],
  openLimitation = false,
  clockAcceptance = "accepted",
  clockEffectiveFrom = "2026-01-01",
  clockEffectiveUntil = null,
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

  const rows = catalogRows();
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
    acceptance: clockAcceptance,
    effectiveFrom: clockEffectiveFrom,
    effectiveUntil: clockEffectiveUntil,
    roundTimeoutPolicy: {
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
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
    identity,
    asOf,
    rules,
    cardPool,
    banlist,
    construction,
    candidateDeck,
    opponentDeck,
    capability,
    clock,
    field,
    events,
  };
}

function publishArtifacts(root, artifacts, extra = []) {
  for (const snapshot of [
    artifacts.rules,
    artifacts.cardPool,
    artifacts.banlist,
    artifacts.construction,
    artifacts.candidateDeck,
    artifacts.opponentDeck,
    artifacts.capability,
    artifacts.clock,
    artifacts.field,
    ...extra,
  ]) {
    publishImmutableArtifact(
      join(root, "data", "derived", DERIVED_DIR[snapshot.kind], `${snapshot.snapshotId}.json`),
      snapshot,
    );
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
    latestPolicy: {
      fieldMaxAgeDays: 30,
      marketMaxAgeDays: 7,
      marketStalenessBlocksStrength: false,
    },
    ...overrides,
  };
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "environment-manifest-test-"));
}

function withRoot(run) {
  const root = makeRoot();
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Re-signs a mutated Manifest with a genuine hash: the stand-in for one
// published by an older or defective builder.
function resign(manifest, mutate) {
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

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentError) return { code: error.code, details: error.details };
    throw error;
  }
  throw new assert.AssertionError({ message: "expected an EnvironmentError but none was thrown" });
}

/* ------------------------------------------------------------------ *
 * Environment key and Manifest identity
 * ------------------------------------------------------------------ */

test("environmentKey is the logical colon-delimited identity including the IANA timezone", () => {
  const key = environmentKey({ ...SC, asOf: "2026-08-20" });

  assert.equal(key, "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20");
  // edition, metagame region, language, canonical IANA timezone, format, asOf
  assert.deepEqual(key.split(":"), ["SC", "CN", "zh-Hans", "Asia/Shanghai", "standard-block2-op16", "2026-08-20"]);
  assert.ok(key.includes("Asia/Shanghai"), "canonical IANA timezone must survive intact");
  assert.equal(environmentKey({ ...EN, asOf: "2026-08-20" }), "EN:GLOBAL_EN:en:America/Los_Angeles:standard-block2-op16:2026-08-20");
});

test("environmentKey rejects a non-native identity and an invalid date", () => {
  assert.equal(codeOf(() => environmentKey({ ...SC, metagameRegion: "JP", asOf: "2026-08-20" })).code, "environment_identity_mismatch");
  assert.equal(codeOf(() => environmentKey({ ...SC, asOf: "2026-13-01" })).code, "environment_identity_mismatch");
  assert.equal(codeOf(() => environmentKey({ ...SC, timeZone: "Not/AZone", asOf: "2026-08-20" })).code, "environment_identity_mismatch");
});

test("manifestId is a filesystem-safe slug with a 16-hex suffix and never the environmentKey", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });

    assert.equal(manifest.environmentKey, "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20");
    assert.notEqual(manifest.manifestId, manifest.environmentKey);
    assert.equal(manifest.manifestId.includes("/"), false);
    assert.equal(manifest.manifestId.includes(":"), false);
    assert.match(manifest.manifestId, /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/);
    assert.ok(manifest.manifestId.startsWith("SC-CN-zh-Hans-Asia-Shanghai-standard-block2-op16-2026-08-20-"));
    assert.equal(manifest.manifestId.endsWith(manifest.contentHash.slice(7, 23)), true);
  });
});

test("two Manifest revisions for one logical key receive different hash-derived IDs", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const first = buildManifest(draftFor(artifacts), { root });
    const second = buildManifest(
      draftFor(artifacts, {
        latestPolicy: { fieldMaxAgeDays: 21, marketMaxAgeDays: 7, marketStalenessBlocksStrength: false },
      }),
      { root },
    );

    assert.equal(first.environmentKey, second.environmentKey);
    assert.notEqual(first.contentHash, second.contentHash);
    assert.notEqual(first.manifestId, second.manifestId);
    assert.equal(first.manifestId.slice(0, -16), second.manifestId.slice(0, -16));
  });
});

test("the logical environmentKey stays inside the hashed payload and the derived IDs stay outside", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const draft = draftFor(artifacts);
    const manifest = buildManifest(draft, { root });

    assert.equal(manifest.contentHash, hashProjection(draft, []));
    assert.equal(manifest.contentHash, hashProjection(manifest, ["manifestId", "contentHash"]));
    assert.notEqual(
      hashProjection({ ...draft, environmentKey: "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-19" }, []),
      manifest.contentHash,
    );
  });
});

test("buildManifest refuses a draft that already carries a derived identity", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);

    assert.equal(codeOf(() => buildManifest({ ...draftFor(artifacts), manifestId: "x-0000000000000000" }, { root })).code, "manifest_invalid");
    assert.equal(codeOf(() => buildManifest({ ...draftFor(artifacts), contentHash: HASH_A }, { root })).code, "manifest_invalid");
  });
});

test("buildManifest refuses an environmentKey that disagrees with its own identity fields", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const failure = codeOf(() => buildManifest(
      draftFor(artifacts, { environmentKey: "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-19" }),
      { root },
    ));

    assert.equal(failure.code, "environment_identity_mismatch");
  });
});

test("buildManifest refuses a non-native identity combination and unknown top-level keys", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);

    assert.equal(
      codeOf(() => buildManifest(draftFor(artifacts, { metagameRegion: "JP", environmentKey: "SC:JP:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20" }), { root })).code,
      "environment_identity_mismatch",
    );
    assert.equal(codeOf(() => buildManifest({ ...draftFor(artifacts), extra: 1 }, { root })).code, "manifest_invalid");
  });
});

/* ------------------------------------------------------------------ *
 * References
 * ------------------------------------------------------------------ */

test("every Manifest reference must be exactly {snapshotId, contentHash} and is reverified", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const base = draftFor(artifacts);

    const withExtra = structuredClone(base);
    withExtra.references.rules = { ...withExtra.references.rules, note: "extra" };
    assert.equal(codeOf(() => buildManifest(withExtra, { root })).code, "manifest_invalid");

    const withoutHash = structuredClone(base);
    delete withoutHash.references.banlist.contentHash;
    assert.equal(codeOf(() => buildManifest(withoutHash, { root })).code, "manifest_invalid");

    const shortHash = structuredClone(base);
    shortHash.references.field.contentHash = "sha256:abc";
    assert.equal(codeOf(() => buildManifest(shortHash, { root })).code, "manifest_invalid");

    const missingReference = structuredClone(base);
    delete missingReference.references.cardPool;
    assert.equal(codeOf(() => buildManifest(missingReference, { root })).code, "manifest_invalid");
  });
});

test("buildManifest rejects a reference whose hash does not match the published artifact", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const wrongHash = structuredClone(draftFor(artifacts));
    wrongHash.references.rules.contentHash = HASH_B;

    assert.equal(codeOf(() => buildManifest(wrongHash, { root })).code, "snapshot_hash_mismatch");
  });
});

test("buildManifest rejects a reference to an artifact that is not published", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const absent = structuredClone(draftFor(artifacts));
    absent.references.field = {
      snapshotId: "field-sc-absent-0123456789abcdef",
      contentHash: HASH_A,
    };

    assert.equal(codeOf(() => buildManifest(absent, { root })).code, "environment_not_found");
  });
});

test("buildManifest rejects a reference whose artifact is the wrong kind", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    // Filed in the RIGHT directory under the RIGHT identifier, but it is a
    // construction snapshot. Referencing it from another directory would exit
    // through the absent branch and never reach the kind check at all.
    publishImmutableArtifact(
      join(root, "data", "derived", DERIVED_DIR.banlist, `${artifacts.construction.snapshotId}.json`),
      artifacts.construction,
    );
    const swapped = structuredClone(draftFor(artifacts));
    swapped.references.banlist = snapshotRef(artifacts.construction);

    const failure = codeOf(() => buildManifest(swapped, { root }));
    assert.equal(failure.code, "environment_not_found");
    assert.equal(failure.details.expectedKind, "banlist");
    assert.equal(failure.details.actualKind, "construction");
  });
});

test("official SC rejects an EN reference in any position", () => {
  withRoot((root) => {
    const sc = buildArtifacts();
    const en = buildArtifacts({ identity: EN });
    publishArtifacts(root, sc);
    publishArtifacts(root, en);
    const borrowed = structuredClone(draftFor(sc));
    borrowed.references.field = snapshotRef(en.field);

    assert.equal(codeOf(() => buildManifest(borrowed, { root })).code, "environment_identity_mismatch");
  });
});

test("legacy evidence cannot enter an official or a proxy Manifest", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    const legacyField = finalizeSnapshot(
      {
        schemaVersion: 1,
        kind: "field",
        environment: SC,
        asOf: "2026-08-20",
        source: { provider: "legacy", surface: "matrix", evidenceStatus: "legacy_unverified" },
        coverage: { status: "complete", warnings: [], missingFields: [] },
        data: { ...artifacts.field.data },
      },
      "field-legacy",
    );
    publishArtifacts(root, artifacts, [legacyField]);

    const official = structuredClone(draftFor(artifacts));
    official.references.field = snapshotRef(legacyField);
    assert.equal(codeOf(() => buildManifest(official, { root })).code, "legacy_evidence_rejected");

    const proxy = structuredClone(proxyDraft(artifacts, root).draft);
    proxy.references.field = snapshotRef(legacyField);
    assert.equal(codeOf(() => buildManifest(proxy, { root })).code, "legacy_evidence_rejected");
  });
});

/* ------------------------------------------------------------------ *
 * Official / proxy policy
 * ------------------------------------------------------------------ */

function matchupSnapshot(artifacts, { identity = EN, overrides = {}, idStem = "matchup-en-prior" } = {}) {
  const cell = (candidate, opponent, seat) => ({
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
        population: "EN ladder fixture",
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

function proxyDraft(artifacts, root) {
  const prior = matchupSnapshot(artifacts);
  publishImmutableArtifact(
    join(root, "data", "derived", DERIVED_DIR.matchup, `${prior.snapshotId}.json`),
    prior,
  );
  const draft = draftFor(artifacts, { kind: "proxy" });
  draft.matchupPolicy.proxyPriorRef = {
    snapshotId: prior.snapshotId,
    contentHash: prior.contentHash,
    originEdition: "EN",
    originEnvironmentKey: environmentKey({ ...EN, asOf: artifacts.asOf }),
  };
  return { draft, prior };
}

test("an official Manifest cannot carry a cross-edition prior", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const { draft } = proxyDraft(artifacts, root);
    const official = { ...structuredClone(draft), kind: "official" };

    assert.equal(codeOf(() => buildManifest(official, { root })).code, "environment_identity_mismatch");
  });
});

test("a proxy Manifest requires kind proxy and a named cross-edition prior", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const { draft } = proxyDraft(artifacts, root);
    const manifest = buildManifest(draft, { root });

    assert.equal(manifest.kind, "proxy");
    assert.equal(manifest.matchupPolicy.proxyPriorRef.originEdition, "EN");

    const withoutPrior = structuredClone(draft);
    withoutPrior.matchupPolicy.proxyPriorRef = null;
    assert.equal(codeOf(() => buildManifest(withoutPrior, { root })).code, "environment_identity_mismatch");

    const sameEdition = structuredClone(draft);
    sameEdition.matchupPolicy.proxyPriorRef.originEdition = "SC";
    assert.equal(codeOf(() => buildManifest(sameEdition, { root })).code, "environment_identity_mismatch");

    const unnamed = structuredClone(draft);
    delete unnamed.matchupPolicy.proxyPriorRef.originEnvironmentKey;
    assert.equal(codeOf(() => buildManifest(unnamed, { root })).code, "manifest_invalid");
  });
});

test("Manifest policy floors are structural and cannot be lowered", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const below = structuredClone(draftFor(artifacts));
    below.matchupPolicy.minimumGamesPerSeat = 199;
    assert.equal(codeOf(() => buildManifest(below, { root })).code, "manifest_invalid");

    const partialField = structuredClone(draftFor(artifacts));
    partialField.matchupPolicy.requiredFieldCoverage = 0.9;
    assert.equal(codeOf(() => buildManifest(partialField, { root })).code, "manifest_invalid");

    const partialMatchup = structuredClone(draftFor(artifacts));
    partialMatchup.matchupPolicy.requiredMatchupCoverage = 0.95;
    assert.equal(codeOf(() => buildManifest(partialMatchup, { root })).code, "manifest_invalid");

    const higher = structuredClone(draftFor(artifacts));
    higher.matchupPolicy.minimumGamesPerSeat = 400;
    assert.equal(buildManifest(higher, { root }).matchupPolicy.minimumGamesPerSeat, 400);
  });
});

test("representative weights and turn-order weights must be positive in-range numbers", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);

    const zeroWeight = structuredClone(draftFor(artifacts));
    zeroWeight.opponents[0].representativeDecks[0].weight = 0;
    assert.equal(codeOf(() => buildManifest(zeroWeight, { root })).code, "manifest_invalid");

    const negativeTurnOrder = structuredClone(draftFor(artifacts));
    negativeTurnOrder.matchupPolicy.turnOrderWeights = { play: -0.5, draw: 1.5 };
    assert.equal(codeOf(() => buildManifest(negativeTurnOrder, { root })).code, "manifest_invalid");

    const noRepresentative = structuredClone(draftFor(artifacts));
    noRepresentative.opponents[0].representativeDecks = [];
    assert.equal(codeOf(() => buildManifest(noRepresentative, { root })).code, "missing_representative_deck");

    const duplicateArchetype = structuredClone(draftFor(artifacts));
    duplicateArchetype.opponents.push(duplicateArchetype.opponents[0]);
    assert.equal(codeOf(() => buildManifest(duplicateArchetype, { root })).code, "manifest_invalid");
  });
});

test("a representative deck entry must match its published DeckSnapshot exactly", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);

    const wrongGameplayHash = structuredClone(draftFor(artifacts));
    wrongGameplayHash.opponents[0].representativeDecks[0].gameplayHash = HASH_B;
    assert.equal(codeOf(() => buildManifest(wrongGameplayHash, { root })).code, "illegal_deck");

    const wrongContentHash = structuredClone(draftFor(artifacts));
    wrongContentHash.opponents[1].representativeDecks[0].contentHash = HASH_B;
    assert.equal(codeOf(() => buildManifest(wrongContentHash, { root })).code, "snapshot_hash_mismatch");

    const absent = structuredClone(draftFor(artifacts));
    absent.opponents[1].representativeDecks[0].deckSnapshotId = "deck-absent-0123456789abcdef";
    assert.equal(codeOf(() => buildManifest(absent, { root })).code, "missing_representative_deck");
  });
});

test("a Manifest whose weights cannot sum to one is neither buildable nor publishable", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);

    const badTurnOrder = structuredClone(draftFor(artifacts));
    badTurnOrder.matchupPolicy.turnOrderWeights = { play: 0.5, draw: 0.4 };
    assert.equal(codeOf(() => buildManifest(badTurnOrder, { root })).code, "manifest_invalid");

    const badRepresentatives = structuredClone(draftFor(artifacts));
    badRepresentatives.opponents[0].representativeDecks = [
      deckEntry(artifacts.candidateDeck, 0.75),
      deckEntry(artifacts.opponentDeck, 0.75),
    ];
    assert.equal(codeOf(() => buildManifest(badRepresentatives, { root })).code, "manifest_invalid");

    // Nothing was published by either refusal.
    assert.equal(readdirSync(join(root, "data")).includes("environments"), false);

    // A Manifest signed some other way must not become publishable or aliasable
    // either: publishManifest re-runs the same sum contract.
    const honest = buildManifest(draftFor(artifacts), { root });
    const unusable = resign(honest, (draft) => {
      draft.matchupPolicy.turnOrderWeights = { play: 0.5, draw: 0.4 };
    });
    assert.equal(verifyManifest(unusable).manifestId, unusable.manifestId);
    assert.equal(
      codeOf(() => publishManifest({ root, manifest: unusable, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "manifest_invalid",
    );
    assert.equal(existsSync(join(root, "data", "environments", `${unusable.manifestId}.json`)), false);
    assert.equal(existsSync(join(root, "data", "environment-aliases")), false);

    // Weights that DO sum to one across several representatives still build.
    const shared = structuredClone(draftFor(artifacts));
    shared.opponents[0].representativeDecks = [
      deckEntry(artifacts.candidateDeck, 0.75),
      deckEntry(artifacts.opponentDeck, 0.25),
    ];
    assert.equal(buildManifest(shared, { root }).opponents[0].representativeDecks.length, 2);
  });
});

test("a proxy prior must come from a different edition than the Manifest itself", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    // A prior that genuinely IS this edition's own evidence: the reference-level
    // cross-edition assertion is satisfied (artifact edition === originEdition),
    // so only the official/proxy policy itself can refuse it.
    const nativePrior = matchupSnapshot(artifacts, { identity: SC, idStem: "matchup-sc-prior" });
    publishImmutableArtifact(
      join(root, "data", "derived", DERIVED_DIR.matchup, `${nativePrior.snapshotId}.json`),
      nativePrior,
    );
    const draft = draftFor(artifacts, { kind: "proxy" });
    draft.matchupPolicy.proxyPriorRef = {
      snapshotId: nativePrior.snapshotId,
      contentHash: nativePrior.contentHash,
      originEdition: "SC",
      originEnvironmentKey: environmentKey({ ...SC, asOf: artifacts.asOf }),
    };

    const failure = codeOf(() => buildManifest(draft, { root }));
    assert.equal(failure.code, "environment_identity_mismatch");
    assert.equal(failure.details.reason, "proxy_prior_same_edition");
  });
});

test("legacy evidence cannot enter through the cross-edition proxy prior either", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    // The prior is by construction where Task 12's legacy EN matrix would knock.
    const legacyPrior = finalizeSnapshot(
      {
        schemaVersion: 1,
        kind: "matchup",
        environment: EN,
        asOf: artifacts.asOf,
        source: {
          provider: "legacy",
          surface: "op16-matchup-matrix",
          sourceRef: { fixtureId: "legacy-en-matrix" },
          evidenceStatus: "legacy_unverified",
        },
        coverage: { status: "complete", warnings: [], missingFields: [] },
        data: structuredClone(matchupSnapshot(artifacts).data),
      },
      "matchup-en-legacy",
    );
    publishImmutableArtifact(
      join(root, "data", "derived", DERIVED_DIR.matchup, `${legacyPrior.snapshotId}.json`),
      legacyPrior,
    );
    const draft = draftFor(artifacts, { kind: "proxy" });
    draft.matchupPolicy.proxyPriorRef = {
      snapshotId: legacyPrior.snapshotId,
      contentHash: legacyPrior.contentHash,
      originEdition: "EN",
      originEnvironmentKey: environmentKey({ ...EN, asOf: artifacts.asOf }),
    };

    const failure = codeOf(() => buildManifest(draft, { root }));
    assert.equal(failure.code, "legacy_evidence_rejected");
    assert.equal(failure.details.path, "matchupPolicy.proxyPriorRef");
  });
});

/* ------------------------------------------------------------------ *
 * verifyManifest
 * ------------------------------------------------------------------ */

test("verifyManifest recomputes the content hash and the ID suffix", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });

    assert.equal(verifyManifest(manifest), manifest);
    assert.deepEqual(manifestRef(manifest), {
      manifestId: manifest.manifestId,
      contentHash: manifest.contentHash,
    });

    const tampered = { ...structuredClone(manifest), asOf: "2026-08-19" };
    assert.equal(codeOf(() => verifyManifest(tampered)).code, "snapshot_hash_mismatch");

    const wrongSuffix = {
      ...structuredClone(manifest),
      manifestId: `${manifest.manifestId.slice(0, -16)}0000000000000000`,
    };
    assert.equal(codeOf(() => verifyManifest(wrongSuffix)).code, "snapshot_hash_mismatch");

    const unsafeId = { ...structuredClone(manifest), manifestId: `../../${manifest.manifestId}` };
    assert.equal(codeOf(() => verifyManifest(unsafeId)).code, "manifest_invalid");

    // Safe, correctly suffixed, hash-valid -- and still not this environment's
    // identity. Only the slug-agreement recheck can see it.
    const foreignSlug = {
      ...structuredClone(manifest),
      manifestId: `EN-GLOBAL_EN-en-America-Los_Angeles-standard-block2-op16-2026-08-20-${manifest.contentHash.slice(7, 23)}`,
    };
    const slugFailure = codeOf(() => verifyManifest(foreignSlug));
    assert.equal(slugFailure.code, "environment_identity_mismatch");
    assert.equal(slugFailure.details.manifestId, foreignSlug.manifestId);
  });
});

test("verifyManifest re-runs the structural policy contract on a re-signed Manifest", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });

    // A tampered Manifest re-signed with a genuine hash is indistinguishable
    // from an honest one by hashing alone. The policy contract must be re-run.
    const lowered = structuredClone(manifest);
    delete lowered.manifestId;
    delete lowered.contentHash;
    lowered.matchupPolicy.minimumGamesPerSeat = 1;
    const contentHash = hashProjection(lowered, []);
    const resigned = {
      ...lowered,
      manifestId: `${manifest.manifestId.slice(0, -16)}${contentHash.slice(7, 23)}`,
      contentHash,
    };

    assert.equal(codeOf(() => verifyManifest(resigned)).code, "manifest_invalid");
  });
});

/* ------------------------------------------------------------------ *
 * Alias grammar and repository mapping
 * ------------------------------------------------------------------ */

test("the alias grammar is a closed registry of environment selectors", () => {
  assert.deepEqual(parseEnvironmentSelector("SC/latest"), {
    mode: "alias",
    aliasName: "SC",
    channel: "latest",
    alias: "SC/latest",
    edition: "SC",
    kind: "official",
  });
  assert.equal(parseEnvironmentSelector("EN/latest").edition, "EN");
  assert.equal(parseEnvironmentSelector("SC_WITH_EN_PRIOR/latest").kind, "proxy");
  assert.equal(parseEnvironmentSelector("SC_WITH_EN_PRIOR/latest").edition, "SC");

  for (const hostile of [
    "SC/../../etc/passwd",
    "../SC/latest",
    "SC/LATEST",
    "sc/latest",
    "SC",
    "SC/latest/extra",
    "JP/latest",
    "SC/stable",
    "",
    "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20",
  ]) {
    assert.equal(codeOf(() => parseEnvironmentSelector(hostile)).code, "environment_not_found", `accepted ${hostile}`);
  }
});

test("repository paths derive only from validated IDs under fixed roots", () => {
  const root = "/repo";
  assert.equal(manifestPath(root, "SC-CN-zh-Hans-standard-2026-08-20-0123456789abcdef"), join(root, "data", "environments", "SC-CN-zh-Hans-standard-2026-08-20-0123456789abcdef.json"));
  assert.equal(aliasRecordPath(root, "SC"), join(root, "data", "environment-aliases", "SC", "latest.json"));
  for (const [kind, directory] of Object.entries(DERIVED_DIR)) {
    assert.equal(
      derivedArtifactPath(root, kind, "artifact-0123456789abcdef"),
      join(root, "data", "derived", directory, "artifact-0123456789abcdef.json"),
    );
  }

  for (const hostile of ["../escape-0123456789abcdef", "a/b-0123456789abcdef", "..", "", "no-hash-suffix"]) {
    assert.equal(codeOf(() => manifestPath(root, hostile)).code, "manifest_invalid", `accepted manifest id ${hostile}`);
    assert.equal(codeOf(() => derivedArtifactPath(root, "deck", hostile)).code, "manifest_invalid", `accepted snapshot id ${hostile}`);
  }
  assert.equal(codeOf(() => derivedArtifactPath(root, "unknown-kind", "artifact-0123456789abcdef")).code, "manifest_invalid");
  assert.equal(codeOf(() => aliasRecordPath(root, "../SC")).code, "environment_not_found");
});

/* ------------------------------------------------------------------ *
 * Publication
 * ------------------------------------------------------------------ */

test("publishManifest publishes the immutable Manifest and only then the alias record", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });
    const result = publishManifest({
      root,
      manifest,
      alias: "SC/latest",
      updatedAt: "2026-08-21T09:00:00+08:00",
    });

    const published = JSON.parse(readFileSync(join(root, "data", "environments", `${manifest.manifestId}.json`), "utf8"));
    assert.deepEqual(published, JSON.parse(JSON.stringify(manifest)));
    assert.deepEqual(result.manifestRef, manifestRef(manifest));

    const aliasRecord = JSON.parse(readFileSync(join(root, "data", "environment-aliases", "SC", "latest.json"), "utf8"));
    assert.deepEqual(aliasRecord, {
      schemaVersion: 1,
      alias: "SC/latest",
      manifestId: manifest.manifestId,
      manifestHash: manifest.contentHash,
      updatedAt: "2026-08-21T09:00:00+08:00",
    });
    assert.deepEqual(result.aliasRecord, aliasRecord);
  });
});

test("publishManifest requires an injected updatedAt instant and never reads host time", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });

    assert.equal(codeOf(() => publishManifest({ root, manifest, alias: "SC/latest" })).code, "manifest_invalid");
    assert.equal(codeOf(() => publishManifest({ root, manifest, alias: "SC/latest", updatedAt: "2026-08-21" })).code, "manifest_invalid");
    assert.equal(codeOf(() => publishManifest({ root, manifest, alias: "SC/latest", updatedAt: Date.now() })).code, "manifest_invalid");
  });
});

test("SC/latest cannot point at an EN Manifest and EN/latest cannot point at an SC Manifest", () => {
  withRoot((root) => {
    const sc = buildArtifacts();
    const en = buildArtifacts({ identity: EN });
    publishArtifacts(root, sc);
    publishArtifacts(root, en);
    const scManifest = buildManifest(draftFor(sc), { root });
    const enManifest = buildManifest(draftFor(en), { root });

    assert.equal(
      codeOf(() => publishManifest({ root, manifest: enManifest, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "environment_identity_mismatch",
    );
    assert.equal(
      codeOf(() => publishManifest({ root, manifest: scManifest, alias: "EN/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "environment_identity_mismatch",
    );
    assert.equal(readdirSync(join(root, "data")).includes("environment-aliases"), false);
  });
});

test("an official Manifest cannot take a proxy alias and a proxy Manifest cannot take SC/latest", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const official = buildManifest(draftFor(artifacts), { root });
    const proxy = buildManifest(proxyDraft(artifacts, root).draft, { root });

    assert.equal(
      codeOf(() => publishManifest({ root, manifest: official, alias: "SC_WITH_EN_PRIOR/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "environment_identity_mismatch",
    );
    assert.equal(
      codeOf(() => publishManifest({ root, manifest: proxy, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "environment_identity_mismatch",
    );

    const ok = publishManifest({ root, manifest: proxy, alias: "SC_WITH_EN_PRIOR/latest", updatedAt: "2026-08-21T09:00:00+08:00" });
    assert.equal(ok.aliasRecord.alias, "SC_WITH_EN_PRIOR/latest");
  });
});

test("a crash before alias publication leaves a valid unaliased Manifest and retry is idempotent", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });
    const aliasFile = join(root, "data", "environment-aliases", "SC", "latest.json");

    // Crash: the immutable Manifest lands, the alias write fails.
    const failingAliasIo = {
      rename: () => { throw new Error("injected_alias_crash"); },
    };
    assert.throws(
      () => publishManifest({
        root,
        manifest,
        alias: "SC/latest",
        updatedAt: "2026-08-21T09:00:00+08:00",
        io: failingAliasIo,
      }),
      /injected_alias_crash/,
    );
    const afterCrash = JSON.parse(readFileSync(join(root, "data", "environments", `${manifest.manifestId}.json`), "utf8"));
    assert.deepEqual(afterCrash, JSON.parse(JSON.stringify(manifest)));
    assert.equal(verifyManifest(afterCrash).manifestId, manifest.manifestId);
    assert.throws(() => readFileSync(aliasFile, "utf8"), /ENOENT/);
    assert.equal(readdirSync(join(root, "data", "environments")).some((entry) => entry.endsWith(".tmp")), false);

    // Retry is idempotent: same immutable artifact, alias now advances.
    const retry = publishManifest({
      root,
      manifest,
      alias: "SC/latest",
      updatedAt: "2026-08-21T10:00:00+08:00",
    });
    assert.deepEqual(retry.manifestRef, manifestRef(manifest));
    assert.equal(JSON.parse(readFileSync(aliasFile, "utf8")).updatedAt, "2026-08-21T10:00:00+08:00");
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "data", "environments", `${manifest.manifestId}.json`), "utf8")),
      JSON.parse(JSON.stringify(manifest)),
    );
  });
});

test("publishManifest refuses a Manifest that fails verification and writes nothing", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });
    const tampered = { ...structuredClone(manifest), asOf: "2026-08-19" };

    assert.equal(
      codeOf(() => publishManifest({ root, manifest: tampered, alias: "SC/latest", updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "snapshot_hash_mismatch",
    );
    assert.equal(readdirSync(join(root, "data")).includes("environments"), false);
  });
});

test("publishing a different Manifest under an existing ID is a collision, not a clobber", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const manifest = buildManifest(draftFor(artifacts), { root });
    const target = join(root, "data", "environments", `${manifest.manifestId}.json`);
    publishManifest({ root, manifest, updatedAt: "2026-08-21T09:00:00+08:00" });

    const squatter = { ...JSON.parse(JSON.stringify(manifest)), contentHash: HASH_B };
    writeFileSync(target, `${JSON.stringify(squatter, null, 2)}\n`);
    assert.equal(
      codeOf(() => publishManifest({ root, manifest, updatedAt: "2026-08-21T09:00:00+08:00" })).code,
      "snapshot_id_collision",
    );
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), squatter);
  });
});

/* ------------------------------------------------------------------ *
 * Golden fixtures
 * ------------------------------------------------------------------ */

test("the checked-in SC Manifest fixtures are reproduced byte-for-byte by the real builders", () => {
  withRoot((root) => {
    const artifacts = buildArtifacts();
    publishArtifacts(root, artifacts);
    const official = buildManifest(draftFor(artifacts), { root });
    const proxy = buildManifest(proxyDraft(artifacts, root).draft, { root });

    assert.deepEqual(JSON.parse(JSON.stringify(official)), fixture("manifest-sc-official.json"));
    assert.deepEqual(JSON.parse(JSON.stringify(proxy)), fixture("manifest-sc-with-en-prior.json"));
    assert.equal(verifyManifest(fixture("manifest-sc-official.json")).kind, "official");
    assert.equal(verifyManifest(fixture("manifest-sc-with-en-prior.json")).kind, "proxy");
  });
});
