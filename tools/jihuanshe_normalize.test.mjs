import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EnvironmentError } from "../environment/errors.mjs";
import { buildFieldSnapshot } from "../environment/field.mjs";
import { snapshotRef, verifySnapshot } from "../environment/snapshot.mjs";
import {
  buildTournamentEvidenceProjection,
  normalizeJiHuanSheCapture,
  normalizeMarketCapture,
  normalizeTournamentCapture,
} from "./jihuanshe_normalize.mjs";

const root = join(process.cwd(), "tests", "fixtures", "jihuanshe");
const mapping = JSON.parse(readFileSync(join(root, "mappings-fixture-v1.json"), "utf8"));
const context = {
  environment: {
    edition: "SC",
    metagameRegion: "CN",
    language: "zh-Hans",
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
  },
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
  asOf: "2026-08-20",
  parserVersion: "jihuanshe-normalizer-v1",
  mapping,
};

function fixtureBytes(relativePath) {
  return readFileSync(join(root, relativePath));
}

function fixture(relativePath) {
  return JSON.parse(fixtureBytes(relativePath));
}

function expected(relativePath) {
  return JSON.parse(readFileSync(join(root, "expected", relativePath), "utf8"));
}

function captureHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("normalizer requires exact raw bytes and explicit context", () => {
  assert.throws(
    () => normalizeJiHuanSheCapture("{}", context),
    (error) => error instanceof EnvironmentError && error.code === "capture_bytes_required",
  );
  assert.throws(
    () => normalizeJiHuanSheCapture(fixtureBytes("capture/tournament-full-field-v2.json"), {
      ...context,
      asOf: undefined,
    }),
    (error) => error instanceof EnvironmentError && error.code === "normalizer_context_invalid",
  );
});

test("full-field tournament output is byte-stable, verified, and privacy-projected", () => {
  const bytes = fixtureBytes("capture/tournament-full-field-v2.json");
  const [snapshot] = normalizeJiHuanSheCapture(bytes, context);
  const expectedSnapshot = expected("tournament-full-field.snapshot-v1.json");

  assert.deepEqual(snapshot, expectedSnapshot);
  assert.equal(snapshot.kind, "tournament_event");
  assert.deepEqual(snapshot.environment, context.environment);
  assert.deepEqual(snapshot.asOf, context.asOf);
  assert.deepEqual(snapshot.data.time, {
    precision: "day",
    localDate: "2026-08-18",
    timeZone: "Asia/Shanghai",
  });
  assert.equal(snapshot.source.captureHash, captureHash(bytes));
  assert.equal(snapshot.source.captureHashScope, "exact-raw-envelope-bytes");
  assert.equal(snapshot.coverage.status, "complete");
  // C1: Task 5's eventQualifies requires a normalized data.status alongside the raw label.
  assert.equal(snapshot.data.status, "completed");
  assert.equal(snapshot.data.identity.status, "已结束");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.equal(snapshot.data.evidenceBlocks.field.denominator.value, 4);
  assert.equal(snapshot.data.evidenceBlocks.field.unresolvedParticipants, 0);
  // M4 (folded into C1): field rows retain both the canonical id and the raw provider label.
  for (const row of snapshot.data.evidenceBlocks.field.rows) {
    assert.equal(typeof row.rawArchetypeLabel, "string");
    assert.ok(row.rawArchetypeLabel.length > 0);
  }
  assert.equal(snapshot.data.evidenceBlocks.results.rows.length, 4);
  assert.equal(snapshot.data.eventEvidenceHash.startsWith("sha256:"), true);
  assert.equal(verifySnapshot(snapshot), snapshot);

  const canonical = JSON.stringify(snapshot);
  assert.equal(canonical.includes("synthetic-entrant-1"), false);
  assert.equal(canonical.includes("joinToken"), false);
  assert.equal(canonical.includes("lifecycle"), false);
});

test("event evidence hash excludes acquisition time but content hash retains it", () => {
  const bytes = fixtureBytes("capture/tournament-full-field-v2.json");
  const [first] = normalizeJiHuanSheCapture(bytes, context);
  const changedCapture = fixture("capture/tournament-full-field-v2.json");
  changedCapture.capturedAt = "2026-08-20T12:01:00Z";
  const changedBytes = Buffer.from(JSON.stringify(changedCapture));
  const [second] = normalizeJiHuanSheCapture(changedBytes, context);

  assert.equal(first.data.eventKey, second.data.eventKey);
  assert.equal(first.data.eventEvidenceHash, second.data.eventEvidenceHash);
  assert.notEqual(first.contentHash, second.contentHash);
  assert.notEqual(first.source.captureHash, second.source.captureHash);
  assert.deepEqual(buildTournamentEvidenceProjection(first), buildTournamentEvidenceProjection(second));
});

test("C2: asOf does not affect eventEvidenceHash, only contentHash/snapshotId", () => {
  const bytes = fixtureBytes("capture/tournament-full-field-v2.json");
  const [dayOne] = normalizeJiHuanSheCapture(bytes, { ...context, asOf: "2026-08-20" });
  const [dayTwo] = normalizeJiHuanSheCapture(bytes, { ...context, asOf: "2026-08-21" });

  assert.equal(dayOne.data.eventKey, dayTwo.data.eventKey);
  assert.equal(dayOne.data.eventEvidenceHash, dayTwo.data.eventEvidenceHash);
  assert.notEqual(dayOne.contentHash, dayTwo.contentHash);
  assert.notEqual(dayOne.snapshotId, dayTwo.snapshotId);
  assert.deepEqual(buildTournamentEvidenceProjection(dayOne), buildTournamentEvidenceProjection(dayTwo));
});

test("batch and single-event captures share event identity and evidence hash", () => {
  // C3: batch data.events[] entries are per-event typed wrappers { sourceRef, data }.
  const source = fixture("capture/tournament-full-field-v2.json");
  const batch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [{ sourceRef: source.sourceRef, data: source.data }] },
  };
  const [single] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(source)), context);
  const [batched] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(batch)), context);

  assert.equal(single.data.eventKey, batched.data.eventKey);
  assert.equal(single.data.eventEvidenceHash, batched.data.eventEvidenceHash);
  assert.equal(single.kind, batched.kind);
});

test("C3: two different batch events get distinct eventKeys and correct per-event sourceRef identity", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  const secondData = fixture("capture/tournament-top-cut-v2.json").data;
  const secondSourceRef = { providerEventId: "fixture-event-002", sanitizedRoute: "app:tournament-detail" };
  const batch = {
    ...source,
    surface: "tournament-batch",
    data: {
      events: [
        { sourceRef: source.sourceRef, data: source.data },
        { sourceRef: secondSourceRef, data: secondData },
      ],
    },
  };
  const [first, second] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(batch)), context);

  assert.notEqual(first.data.eventKey, second.data.eventKey);
  assert.equal(first.source.sourceRef.providerEventId, "fixture-event-001");
  assert.equal(second.source.sourceRef.providerEventId, "fixture-event-002");
});

test("top-cut and unresolved mappings publish incomplete source evidence only", () => {
  const topCut = normalizeJiHuanSheCapture(
    fixtureBytes("capture/tournament-top-cut-v2.json"),
    context,
  )[0];
  assert.equal(topCut.coverage.status, "partial");
  assert.equal(topCut.data.evidenceBlocks.field.sampleFrame, "top-cut");
  assert.equal(topCut.data.evidenceBlocks.field.coverage.status, "partial");
  assert.ok(topCut.coverage.warnings.includes("frame_top_cut")); // I8

  const unresolvedMapping = { ...mapping, entries: {} };
  const unresolved = normalizeJiHuanSheCapture(
    fixtureBytes("capture/tournament-full-field-v2.json"),
    { ...context, mapping: unresolvedMapping },
  )[0];
  assert.equal(unresolved.coverage.status, "partial");
  assert.equal(unresolved.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(unresolved.data.evidenceBlocks.field.unresolvedLabels.length > 0);
  assert.equal(unresolved.data.evidenceBlocks.field.coverage.status, "partial");
  assert.ok(unresolved.coverage.warnings.includes("unresolved_mapping"));
});

test("I3(a): a single event without providerEventId gets a deterministic fallback key", () => {
  const bytes = fixtureBytes("capture/tournament-ambiguous-v2.json");
  const [first] = normalizeJiHuanSheCapture(bytes, context);
  const [second] = normalizeJiHuanSheCapture(bytes, context);

  assert.equal(first.data.eventKey, second.data.eventKey);
  assert.equal(first.source.sourceRef.providerEventId, null);
  assert.ok(first.data.eventKey.startsWith("jihuanshe:tournament:fallback:"));
});

test("I3(b): two batch events indistinguishable on the present identity fields are ambiguous", () => {
  const base = fixture("capture/tournament-ambiguous-v2.json");
  const sharedSourceRef = { sanitizedRoute: "app:tournament-detail" };
  const batch = {
    ...base,
    surface: "tournament-batch",
    data: {
      events: [
        { sourceRef: sharedSourceRef, data: base.data },
        { sourceRef: sharedSourceRef, data: base.data },
      ],
    },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(batch)), context),
    (error) => error instanceof EnvironmentError && error.code === "event_identity_ambiguous",
  );
});

test("I1: checks 3 and 4 demote to unknown with warnings, never throw; duplicates remain a hard failure", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.data.decks.distributionRows[0].percentageLabel = "49%";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.coverage.status, "partial");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(snapshot.coverage.warnings.includes("percentage_denominator_mismatch"));

  const duplicate = fixture("capture/tournament-full-field-v2.json");
  duplicate.data.results.rows[1].rank = 1;
  assert.throws(
    () => normalizeTournamentCapture(duplicate, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(duplicate))) }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("I1: a Top Cut page whose distribution total disagrees with its own entrant rows still publishes, never refuses", () => {
  const source = fixture("capture/tournament-top-cut-v2.json");
  // Standings show participantCountLabel "8人" (the whole event's declared size); the deck
  // tab's own distribution rows are mutated to sum to 32, well past its own 2 entrant rows --
  // an internal inconsistency that used to be a hard `field_not_representative` throw before
  // the frame was ever determined. It must now only demote/warn, never refuse.
  source.data.decks.distributionRows = [
    { rawArchetypeLabel: "合成红艾斯", count: 16, percentageLabel: "50%" },
    { rawArchetypeLabel: "合成黑黄蒂奇", count: 16, percentageLabel: "50%" },
  ];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "top-cut");
  assert.equal(snapshot.coverage.status, "partial");
  assert.ok(snapshot.coverage.warnings.includes("frame_top_cut"));
});

test("I4: a duplicate joinToken error redacts the token value", () => {
  const duplicate = fixture("capture/tournament-full-field-v2.json");
  duplicate.data.decks.entrantRows[1].joinToken = duplicate.data.decks.entrantRows[0].joinToken;
  let caught;
  try {
    normalizeTournamentCapture(duplicate, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(duplicate))) });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof EnvironmentError);
  assert.equal(caught.code, "normalization_failed");
  assert.equal(caught.message.includes("synthetic-entrant"), false);
  assert.equal(JSON.stringify(caught.details).includes("synthetic-entrant"), false);
});

test("market output keeps canonical card identity separate from visible printing", () => {
  const bytes = fixtureBytes("capture/market-visible-viewport-v2.json");
  const [snapshot] = normalizeJiHuanSheCapture(bytes, context);
  const expectedSnapshot = expected("market-visible-viewport.snapshot-v1.json");

  assert.deepEqual(snapshot, expectedSnapshot);
  assert.equal(snapshot.kind, "market");
  assert.equal(snapshot.data.scope, "visible-viewport");
  assert.equal(snapshot.data.paginationComplete, false);
  assert.equal(snapshot.data.visibleRowCount, snapshot.data.rows.length);
  assert.equal(snapshot.data.rows[0].currency, "CNY");
  assert.equal(snapshot.data.rows[0].gameplayId, "OP16-001");
  assert.equal(snapshot.data.rows[0].printingId, "OP16-001");
  assert.equal(snapshot.data.rows[1].gameplayId, "OP16-001");
  assert.equal(snapshot.data.rows[1].printingId, "OP16-001-P");
  assert.equal(snapshot.data.rows[2].gameplayId, null);
  assert.equal(verifySnapshot(snapshot), snapshot);
  assert.equal(JSON.stringify(snapshot).includes("synthetic-private"), false);
});

test("market rows must be a complete visible viewport and CNY-labelled", () => {
  const source = fixture("capture/market-visible-viewport-v2.json");
  source.data.visibleRowCount = 99;
  assert.throws(
    () => normalizeMarketCapture(source, context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const invalidCurrency = fixture("capture/market-visible-viewport-v2.json");
  invalidCurrency.data.rows[0].observedPriceLabel = "$1.00";
  assert.throws(
    () => normalizeMarketCapture(invalidCurrency, context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

// --- Gaps identified in round 1 against the brief's rulings: privacy sentinels, the
// percentage half-unit tolerance's PASSING side, incomplete entrant join, submitted-only, and
// unsupported schema/surface/status/game. Each throwing scenario is exercised on an in-memory
// clone so the golden fixtures stay untouched and byte-stable.

test("a raw participant handle anywhere in a row is a privacy-contract violation, not a silent drop", () => {
  const withHandle = fixture("capture/tournament-full-field-v2.json");
  withHandle.data.results.rows[0].participantHandleLabel = "synthetic-private-handle-1";
  assert.throws(
    () => normalizeTournamentCapture(withHandle, {
      ...context,
      captureHash: captureHash(Buffer.from(JSON.stringify(withHandle))),
    }),
    (error) => error instanceof EnvironmentError && error.code === "privacy_contract_violation",
  );

  const withSellerHandle = fixture("capture/market-visible-viewport-v2.json");
  withSellerHandle.data.rows[0].sellerHandleLabel = "synthetic-private-seller-1";
  assert.throws(
    () => normalizeMarketCapture(withSellerHandle, {
      ...context,
      captureHash: captureHash(Buffer.from(JSON.stringify(withSellerHandle))),
    }),
    (error) => error instanceof EnvironmentError && error.code === "privacy_contract_violation",
  );
});

test("a legitimately rounded percentage within half a displayed unit is accepted, not just a wrong one rejected", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-tolerance-001";
  source.data.identity.participantCountLabel = "3人";
  source.data.results.rows = [
    { providerRowId: "r1", rank: 1, record: "2-0-0", score: 6, joinToken: "synthetic-tolerance-1", rawArchetypeLabel: "合成红艾斯" },
    { providerRowId: "r2", rank: 2, record: "1-1-0", score: 3, joinToken: "synthetic-tolerance-2", rawArchetypeLabel: "合成黑黄蒂奇" },
    { providerRowId: "r3", rank: 3, record: "0-2-0", score: 0, joinToken: "synthetic-tolerance-3", rawArchetypeLabel: "合成黑黄蒂奇" },
  ];
  source.data.decks.distributionRows = [
    { rawArchetypeLabel: "合成红艾斯", count: 1, percentageLabel: "33%" },
    { rawArchetypeLabel: "合成黑黄蒂奇", count: 2, percentageLabel: "67%" },
  ];
  source.data.decks.entrantRows = [
    { providerRowId: "d1", joinToken: "synthetic-tolerance-1", rawArchetypeLabel: "合成红艾斯" },
    { providerRowId: "d2", joinToken: "synthetic-tolerance-2", rawArchetypeLabel: "合成黑黄蒂奇" },
    { providerRowId: "d3", joinToken: "synthetic-tolerance-3", rawArchetypeLabel: "合成黑黄蒂奇" },
  ];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });

  assert.equal(snapshot.coverage.status, "complete");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.equal(snapshot.data.evidenceBlocks.field.denominator.value, 3);
  assert.deepEqual(
    snapshot.data.evidenceBlocks.field.rows,
    [
      { archetypeId: "leader:OP16-001", players: 1, rawArchetypeLabel: "合成红艾斯" },
      { archetypeId: "leader:OP16-080", players: 2, rawArchetypeLabel: "合成黑黄蒂奇" },
    ],
  );
});

test("an incomplete entrant join downgrades to partial evidence instead of throwing", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-incomplete-join-001";
  // Entrant d4 (synthetic-entrant-4) never submitted a deck, so the decks tab and the
  // results tab disagree on the participant set. The distribution counts are adjusted
  // to match the entrants that ARE present so this is isolated from the percentage
  // reconciliation and duplicate-row checks.
  source.data.decks.entrantRows = source.data.decks.entrantRows.slice(0, 3);
  source.data.decks.distributionRows = [
    { rawArchetypeLabel: "合成红艾斯", count: 2, percentageLabel: "67%" },
    { rawArchetypeLabel: "合成黑黄蒂奇", count: 1, percentageLabel: "33%" },
  ];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });

  assert.equal(snapshot.coverage.status, "partial");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(snapshot.coverage.warnings.includes("incomplete_entrant_join"));
  assert.equal(snapshot.data.evidenceBlocks.results.rows.length, 4);
});

test("a submitted-only event (deck lists but no results yet) is partial evidence, not a failure", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-submitted-only-001";
  source.data.results.rows = [];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });

  assert.equal(snapshot.coverage.status, "partial");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "submitted-only");
  assert.equal(snapshot.data.evidenceBlocks.results.rows.length, 0);
  assert.ok(snapshot.coverage.warnings.includes("results_rows_absent")); // I8
});

test("unsupported schema, status, surface, and game fail closed with no artifact", () => {
  const badSchema = fixture("capture/tournament-full-field-v2.json");
  badSchema.schemaVersion = 1;
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badSchema)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const badStatus = fixture("capture/tournament-full-field-v2.json");
  badStatus.status = "error";
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badStatus)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const badSurface = fixture("capture/tournament-full-field-v2.json");
  badSurface.surface = "leaderboard";
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badSurface)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const badGame = fixture("capture/tournament-full-field-v2.json");
  badGame.data.identity.game = "英语版";
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badGame)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

// --- Round 2 (review findings): I5's fifteen surviving mutants, I6's provider-observedAt
// capability, and I7's envelope-level allowlist. Each test name is tagged with its finding id.

test("I5: an unexpected but non-sensitive row field is a normalization failure, not a silent drop", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.data.results.rows[0].uiRowColorHint = "red";
  assert.throws(
    () => normalizeTournamentCapture(source, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(source))) }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("I5: a timestamp-shaped startLabel produces timestamp precision, not day precision", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-timestamp-001";
  source.data.identity.startLabel = "2026-08-18T19:00:00+08:00";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.deepEqual(snapshot.data.time, {
    precision: "timestamp",
    eventStartedAt: "2026-08-18T19:00:00+08:00",
    timeZone: "Asia/Shanghai",
  });
});

test("I5: duplicate results providerRowId is a normalization failure", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.data.results.rows[1].providerRowId = source.data.results.rows[0].providerRowId;
  assert.throws(
    () => normalizeTournamentCapture(source, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(source))) }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("I5: a CNY price with a thousands separator parses correctly", () => {
  const source = fixture("capture/market-visible-viewport-v2.json");
  source.data.rows[0].observedPriceLabel = "¥1,234.56";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeMarketCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.rows[0].observedPrice, 1234.56);
});

test("I5: an all-zero event never reaches full-field despite vacuously passing every other check", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-empty-001";
  source.data.identity.participantCountLabel = "0人";
  source.data.results.rows = [];
  source.data.decks.entrantRows = [];
  source.data.decks.distributionRows = [];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.notEqual(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.ok(snapshot.coverage.warnings.includes("denominator_missing"));
});

test("I5: a non-completed status label always carries the event_not_completed warning (and never gates the ladder)", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-in-progress-001";
  source.data.identity.status = "进行中";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.ok(snapshot.coverage.warnings.includes("event_not_completed"));
  assert.equal(snapshot.data.status, "进行中");
});

test("I5: an unrecognized sample frame label always carries its warning", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-other-frame-001";
  source.data.decks.sampleFrameLabel = "分组赛";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.ok(snapshot.coverage.warnings.includes("unrecognized_sample_frame_label"));
});

test("I5: a non-string market filterLabels entry is a normalization failure", () => {
  const source = fixture("capture/market-visible-viewport-v2.json");
  source.data.query.filterLabels = ["简中", 123];
  assert.throws(
    () => normalizeMarketCapture(source, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(source))) }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("I6: a provider-stated data.observedAt is used verbatim and appears in the evidence projection", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-observed-at-001";
  source.data.observedAt = "2026-08-19T20:00:00+08:00";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.source.observedAtSource, "provider");
  assert.equal(snapshot.source.observedAt, "2026-08-19T20:00:00+08:00");
  const projection = buildTournamentEvidenceProjection(snapshot);
  assert.deepEqual(projection.observedAt, { source: "provider", value: "2026-08-19T20:00:00+08:00" });

  // The capture-fallback branch (no provider time) must project only the stable marker.
  const [fallbackSnapshot] = normalizeJiHuanSheCapture(fixtureBytes("capture/tournament-full-field-v2.json"), context);
  const fallbackProjection = buildTournamentEvidenceProjection(fallbackSnapshot);
  assert.deepEqual(fallbackProjection.observedAt, { source: "capture_fallback" });
});

test("I5: paginationComplete and scope are output constants, never a passthrough of input", () => {
  const source = fixture("capture/market-visible-viewport-v2.json");
  source.data.paginationComplete = true;
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeMarketCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.paginationComplete, false);
  assert.equal(snapshot.data.scope, "visible-viewport");
});

test("I5: the field denominator is always the participant-count label, never silently the entrant count", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-denominator-001";
  source.data.decks.entrantRows = source.data.decks.entrantRows.slice(0, 3);
  source.data.decks.distributionRows = [
    { rawArchetypeLabel: "合成红艾斯", count: 2, percentageLabel: "67%" },
    { rawArchetypeLabel: "合成黑黄蒂奇", count: 1, percentageLabel: "33%" },
  ];
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.evidenceBlocks.field.denominator.value, 4);
  assert.notEqual(snapshot.data.evidenceBlocks.field.denominator.value, 3);
});

test("I5: multiple simultaneous warnings are lexicographically sorted", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-multi-warning-001";
  source.data.identity.status = "进行中";
  source.data.decks.sampleFrameLabel = "分组赛";
  source.data.decks.entrantRows = source.data.decks.entrantRows.slice(0, 3);
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.deepEqual(
    snapshot.coverage.warnings,
    [
      "archetype_count_denominator_mismatch",
      "distribution_total_entrant_mismatch",
      "event_not_completed",
      "incomplete_entrant_join",
      "unrecognized_sample_frame_label",
    ],
  );
});

test("I5: distribution totals that disagree with the entrant row count are flagged, never silently accepted", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-distribution-mismatch-001";
  source.data.decks.distributionRows[1].count = 3;
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.ok(snapshot.coverage.warnings.includes("distribution_total_entrant_mismatch"));
  assert.notEqual(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
});

test("I5: a mapping entry whose printingId disagrees with the row's own printing is treated as unresolved", () => {
  const source = fixture("capture/market-visible-viewport-v2.json");
  source.data.rows[0].printingId = "OP16-001-P";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeMarketCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.rows[0].gameplayId, null);
});

test("I7: an unknown top-level envelope field is a normalization failure (hostile envelope)", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.credentials = "synthetic-should-never-appear";
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(source)), context),
    (error) => error instanceof EnvironmentError && error.code === "privacy_contract_violation",
  );
});

test("C1: the golden tournament snapshot integrates with environment/field.mjs buildFieldSnapshot", () => {
  const goldenSnapshot = expected("tournament-full-field.snapshot-v1.json");
  // The window must cover the event's own local date (2026-08-18) AND its asOf must be no
  // earlier than the snapshot's own asOf (2026-08-20, the normalization context's asOf at
  // capture time) -- environment/field.mjs rejects an event whose asOf is later than the
  // field window's asOf.
  const window = { startLocalDate: "2026-08-18", asOf: "2026-08-20", timeZone: "Asia/Shanghai" };
  const field = buildFieldSnapshot({
    events: [goldenSnapshot],
    identity: context.environment,
    window,
    sourceRefs: [snapshotRef(goldenSnapshot)],
    selectionPolicy: { id: "explicit-source-order-v1" },
  });

  assert.equal(field.data.totalParticipants, 4);
  assert.deepEqual(
    field.data.archetypes,
    [
      { archetypeId: "leader:OP16-001", players: 2, share: 0.5 },
      { archetypeId: "leader:OP16-080", players: 2, share: 0.5 },
    ],
  );
});

// --- Round 2 (re-review findings): I2(a)'s demote-not-throw fix, N1's order-free field-row
// label, N2's batch-path allowlists, N3's restored check-6 label discipline, and N4's
// data.observedAt shape validation. Each test name is tagged with its finding id.

test("I2(a): an absent or unparseable participantCountLabel demotes instead of throwing", () => {
  const absent = fixture("capture/tournament-full-field-v2.json");
  absent.sourceRef.providerEventId = "fixture-event-i2a-absent-001";
  delete absent.data.identity.participantCountLabel;
  const absentBytes = Buffer.from(JSON.stringify(absent));
  const absentSnapshot = normalizeTournamentCapture(absent, { ...context, captureHash: captureHash(absentBytes) });
  assert.equal(absentSnapshot.coverage.status, "partial");
  assert.equal(absentSnapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(absentSnapshot.coverage.warnings.includes("denominator_missing"));
  assert.equal(absentSnapshot.data.evidenceBlocks.field.denominator.value, null);

  const unparseable = fixture("capture/tournament-full-field-v2.json");
  unparseable.sourceRef.providerEventId = "fixture-event-i2a-unparseable-001";
  unparseable.data.identity.participantCountLabel = "很多人";
  const unparseableBytes = Buffer.from(JSON.stringify(unparseable));
  const unparseableSnapshot = normalizeTournamentCapture(unparseable, { ...context, captureHash: captureHash(unparseableBytes) });
  assert.equal(unparseableSnapshot.coverage.status, "partial");
  assert.equal(unparseableSnapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(unparseableSnapshot.coverage.warnings.includes("denominator_missing"));
  assert.equal(unparseableSnapshot.data.evidenceBlocks.field.denominator.value, null);
});

test("N1: an alias mapping (two raw labels -> one archetypeId) produces an order-free eventEvidenceHash", () => {
  const aliasMapping = {
    ...mapping,
    entries: {
      ...mapping.entries,
      合成红艾斯别名: { archetypeId: "leader:OP16-001", leaderGameplayId: "OP16-001" },
    },
  };

  const forward = fixture("capture/tournament-full-field-v2.json");
  forward.sourceRef.providerEventId = "fixture-event-n1-001";
  // Two of the four entrants play the SAME archetype under two DIFFERENT raw labels -- an
  // aliasing scenario the mapping registry is explicitly allowed to describe.
  forward.data.decks.entrantRows[2].rawArchetypeLabel = "合成红艾斯别名";
  const forwardBytes = Buffer.from(JSON.stringify(forward));
  const forwardSnapshot = normalizeTournamentCapture(
    forward,
    { ...context, mapping: aliasMapping, captureHash: captureHash(forwardBytes) },
  );

  const reversed = fixture("capture/tournament-full-field-v2.json");
  reversed.sourceRef.providerEventId = "fixture-event-n1-001";
  reversed.data.decks.entrantRows[2].rawArchetypeLabel = "合成红艾斯别名";
  reversed.data.decks.entrantRows = [...reversed.data.decks.entrantRows].reverse();
  const reversedBytes = Buffer.from(JSON.stringify(reversed));
  const reversedSnapshot = normalizeTournamentCapture(
    reversed,
    { ...context, mapping: aliasMapping, captureHash: captureHash(reversedBytes) },
  );

  assert.equal(forwardSnapshot.data.eventEvidenceHash, reversedSnapshot.data.eventEvidenceHash);
  assert.deepEqual(forwardSnapshot.data.evidenceBlocks.field.rows, reversedSnapshot.data.evidenceBlocks.field.rows);
});

test("N2: the batch data container is allowlisted (sensitive and benign hostile keys both rejected)", () => {
  const source = fixture("capture/tournament-full-field-v2.json");

  const sensitiveBatch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [{ sourceRef: source.sourceRef, data: source.data }], deviceId: "synthetic-should-never-appear" },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(sensitiveBatch)), context),
    (error) => error instanceof EnvironmentError && error.code === "privacy_contract_violation",
  );

  const benignBatch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [{ sourceRef: source.sourceRef, data: source.data }], debugNote: "hello" },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(benignBatch)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("N2: each batch entry wrapper is allowlisted (sensitive and benign hostile keys both rejected)", () => {
  const source = fixture("capture/tournament-full-field-v2.json");

  const sensitiveEntryBatch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [{ sourceRef: source.sourceRef, data: source.data, credentials: "synthetic-should-never-appear" }] },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(sensitiveEntryBatch)), context),
    (error) => error instanceof EnvironmentError && error.code === "privacy_contract_violation",
  );

  const benignEntryBatch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [{ sourceRef: source.sourceRef, data: source.data, debugNote: "hello" }] },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(benignEntryBatch)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("N3: an absent sample-frame label passes check 6; promotion still requires a complete join", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-n3-absent-001";
  delete source.data.decks.sampleFrameLabel;
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.equal(snapshot.coverage.warnings.includes("unrecognized_sample_frame_label"), false);
});

test("N3: the top-cut label family (Chinese and case-insensitive English variants) all map to top-cut", () => {
  for (const label of ["淘汰赛", "top cut", "TOP CUT", "ToP cUt"]) {
    const source = fixture("capture/tournament-top-cut-v2.json");
    source.sourceRef.providerEventId = `fixture-event-n3-topcut-${encodeURIComponent(label)}`;
    source.data.decks.sampleFrameLabel = label;
    const bytes = Buffer.from(JSON.stringify(source));
    const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
    assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "top-cut", `label ${label} should map to top-cut`);
    assert.ok(snapshot.coverage.warnings.includes("frame_top_cut"));
  }
});

test("N3: an unrecognized sample-frame label (e.g. 分组赛) fails check 6 and cannot reach full-field even with a complete join", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.sourceRef.providerEventId = "fixture-event-n3-other-001";
  source.data.decks.sampleFrameLabel = "分组赛";
  const bytes = Buffer.from(JSON.stringify(source));
  const snapshot = normalizeTournamentCapture(source, { ...context, captureHash: captureHash(bytes) });
  assert.notEqual(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(snapshot.coverage.warnings.includes("unrecognized_sample_frame_label"));
});

test("N4: a malformed data.observedAt is a normalization failure, not a silent fallback", () => {
  const notATimestamp = fixture("capture/tournament-full-field-v2.json");
  notATimestamp.sourceRef.providerEventId = "fixture-event-n4-bad-001";
  notATimestamp.data.observedAt = "not-a-timestamp";
  assert.throws(
    () => normalizeTournamentCapture(notATimestamp, {
      ...context,
      captureHash: captureHash(Buffer.from(JSON.stringify(notATimestamp))),
    }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const wrongType = fixture("capture/tournament-full-field-v2.json");
  wrongType.sourceRef.providerEventId = "fixture-event-n4-bad-002";
  wrongType.data.observedAt = 12345;
  assert.throws(
    () => normalizeTournamentCapture(wrongType, {
      ...context,
      captureHash: captureHash(Buffer.from(JSON.stringify(wrongType))),
    }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

// --- Fix round 3 (cross-task contract ruling): the tournament-batch wrapper's data container
// gains an OPTIONAL requestWindow field ({ asOf, windowDays }) carrying the Task 8 capture
// window. It is acquisition context, not event evidence -- allowlisted and shape-validated on
// the batch surface only, rejected everywhere else, and it must never flow into any per-event
// snapshot's data or evidence hash.

test("R3: a valid data.requestWindow is accepted on the tournament-batch surface", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  const batch = {
    ...source,
    surface: "tournament-batch",
    data: {
      requestWindow: { asOf: "2026-08-20", windowDays: 30 },
      events: [{ sourceRef: source.sourceRef, data: source.data }],
    },
  };
  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(batch)), context);
  assert.equal(snapshot.kind, "tournament_event");
  assert.equal(snapshot.data.eventKey, "jihuanshe:tournament:fixture-event-001");
});

test("R3: a malformed data.requestWindow is a normalization failure", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  const baseEvents = [{ sourceRef: source.sourceRef, data: source.data }];

  const badAsOf = {
    ...source,
    surface: "tournament-batch",
    data: { requestWindow: { asOf: "20260820", windowDays: 30 }, events: baseEvents },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badAsOf)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const badWindowDaysZero = {
    ...source,
    surface: "tournament-batch",
    data: { requestWindow: { asOf: "2026-08-20", windowDays: 0 }, events: baseEvents },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badWindowDaysZero)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const badWindowDaysType = {
    ...source,
    surface: "tournament-batch",
    data: { requestWindow: { asOf: "2026-08-20", windowDays: "30" }, events: baseEvents },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(badWindowDaysType)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const unknownKeyInside = {
    ...source,
    surface: "tournament-batch",
    data: {
      requestWindow: { asOf: "2026-08-20", windowDays: 30, note: "hi" },
      events: baseEvents,
    },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(unknownKeyInside)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const wrongType = {
    ...source,
    surface: "tournament-batch",
    data: { requestWindow: "2026-08-20", events: baseEvents },
  };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(wrongType)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("R3: requestWindow is rejected as an unknown field on the single-tournament and market surfaces", () => {
  const single = fixture("capture/tournament-full-field-v2.json");
  single.data.requestWindow = { asOf: "2026-08-20", windowDays: 30 };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(single)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );

  const market = fixture("capture/market-visible-viewport-v2.json");
  market.data.requestWindow = { asOf: "2026-08-20", windowDays: 30 };
  assert.throws(
    () => normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(market)), context),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
});

test("R3: requestWindow is acquisition context only -- identical per-event eventKey/eventEvidenceHash with or without it, and it never enters snapshot data", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  const events = [{ sourceRef: source.sourceRef, data: source.data }];

  const withWindow = {
    ...source,
    surface: "tournament-batch",
    data: { requestWindow: { asOf: "2026-08-20", windowDays: 30 }, events },
  };
  const withoutWindow = {
    ...source,
    surface: "tournament-batch",
    data: { events },
  };

  const [withSnapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(withWindow)), context);
  const [withoutSnapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(withoutWindow)), context);

  assert.equal(withSnapshot.data.eventKey, withoutSnapshot.data.eventKey);
  assert.equal(withSnapshot.data.eventEvidenceHash, withoutSnapshot.data.eventEvidenceHash);
  assert.deepEqual(
    buildTournamentEvidenceProjection(withSnapshot),
    buildTournamentEvidenceProjection(withoutSnapshot),
  );
  // The raw batch bytes genuinely differ (requestWindow present vs. absent), so the
  // acquisition-only captureHash/contentHash correctly DIFFER too -- only evidence-level
  // identity is invariant, exactly mirroring the capturedAt/asOf precedent from earlier rounds.
  assert.notEqual(withSnapshot.source.captureHash, withoutSnapshot.source.captureHash);
  assert.notEqual(withSnapshot.contentHash, withoutSnapshot.contentHash);
  assert.equal(JSON.stringify(withSnapshot).includes("requestWindow"), false);
  assert.equal(JSON.stringify(withSnapshot).includes("windowDays"), false);
});

/* ------------------------------------------------------------------------------------- *
 * I-1 (final fix wave) -- the snapshot BODY is value-screened, not merely key-screened
 * ------------------------------------------------------------------------------------- */

// The four probe values the whole-branch review used. Every one of them survived verbatim into
// data/sources/** before this screen existed.
const PROBE_TITLE = "上海周赛 主办人张伟 13800138000 微信 zhangwei_op";
const PROBE_ORGANIZER = "李娜 (13900001111)";
const PROBE_LOCATION = "上海市黄浦区南京东路300号2楼502室";
const PROBE_CREDENTIAL = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

function screenedTournamentSnapshot(identityOverrides, envelopeOverrides = {}) {
  const envelope = fixture("capture/tournament-full-field-v2.json");
  envelope.data.identity = { ...envelope.data.identity, ...identityOverrides };
  Object.assign(envelope, envelopeOverrides);
  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(envelope)), context);
  return snapshot;
}

test("I-1: a phone number, a WeChat id, an e-mail and a bearer token are redacted IN PLACE in the published body", () => {
  const snapshot = screenedTournamentSnapshot({
    title: PROBE_TITLE,
    organizerLabel: PROBE_ORGANIZER,
    locationLabel: PROBE_LOCATION,
    formatLabel: PROBE_CREDENTIAL,
  });
  const serialized = JSON.stringify(snapshot);

  // Not one probe identifier reaches the artifact.
  for (const secret of ["13800138000", "13900001111", "zhangwei_op", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  // ...and the surrounding text is KEPT, which is the whole point of redacting a span rather than
  // dropping the field: the event stays usable evidence.
  assert.equal(snapshot.data.identity.title, "上海周赛 主办人张伟 [redacted] 微信 [redacted]");
  assert.equal(snapshot.data.identity.organizerLabel, "李娜 ([redacted])");
  assert.equal(snapshot.data.identity.formatLabel, "Authorization: [redacted]");
  // A venue address is not one of the ruled shapes and is retained in full.
  assert.equal(snapshot.data.identity.locationLabel, PROBE_LOCATION);

  // Every redaction names its own field, and the capture still published.
  assert.equal(snapshot.kind, "tournament_event");
  assert.deepEqual(snapshot.coverage.warnings.filter((w) => w.startsWith("sensitive_value_redacted")), [
    "sensitive_value_redacted:data.identity.formatLabel:credential",
    "sensitive_value_redacted:data.identity.organizerLabel:phone_number",
    "sensitive_value_redacted:data.identity.title:contact_id",
    "sensitive_value_redacted:data.identity.title:phone_number",
  ]);
});

test("I-1: a clean Chinese event title, organizer and location pass through byte-identical with no warning", () => {
  const clean = {
    // `OnePieceChampionshipSeries` is a 26-character alphanumeric run. It survives ONLY because the
    // opaque-token rule is anchored to the whole value; unanchor it and this legitimate title is
    // eaten, which is why the anchoring is asserted here rather than only described in a comment.
    title: "OnePieceChampionshipSeries 2026 深圳南山旗舰店周末例赛",
    organizerLabel: "深圳南山旗舰店",
    locationLabel: "深圳市南山区科技园一号店 3楼",
  };
  const snapshot = screenedTournamentSnapshot(clean);
  assert.equal(snapshot.data.identity.title, clean.title);
  assert.equal(snapshot.data.identity.organizerLabel, clean.organizerLabel);
  assert.equal(snapshot.data.identity.locationLabel, clean.locationLabel);
  assert.deepEqual(snapshot.coverage.warnings.filter((w) => w.startsWith("sensitive_value_redacted")), []);
  assert.deepEqual(snapshot.coverage.warnings.filter((w) => w.startsWith("free_text_truncated")), []);
});

test("I-1: a label that is nothing but a long opaque run is replaced wholesale", () => {
  // Task 8's own rule, anchored to the WHOLE value: an unlabelled bearer/session token looks like
  // this, and nothing else in an SC event label does. The anchoring is what stops it eating the
  // middle of an ordinary title, so both halves are asserted here.
  const snapshot = screenedTournamentSnapshot({
    organizerLabel: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    locationLabel: "上海OP周赛 第12期 深圳南山旗舰店",
  });
  assert.equal(snapshot.data.identity.organizerLabel, "[redacted]");
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.identity.organizerLabel:opaque_token"));
  assert.equal(snapshot.data.identity.locationLabel, "上海OP周赛 第12期 深圳南山旗舰店");
  assert.equal(JSON.stringify(snapshot).includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), false);
});

test("I-1: an unbounded free-text blob is capped, and the cap names its field", () => {
  const snapshot = screenedTournamentSnapshot({ title: "赛事".repeat(200) });
  assert.equal(snapshot.data.identity.title.length, 120 + "[truncated]".length);
  assert.ok(snapshot.data.identity.title.endsWith("[truncated]"));
  assert.ok(snapshot.coverage.warnings.includes("free_text_truncated:data.identity.title"));
});

test("I-1: the value screen also covers sanitizedRoute and the market surface's free-text labels", () => {
  const routed = screenedTournamentSnapshot({}, {
    sourceRef: { providerEventId: "fixture-event-001", sanitizedRoute: "app:tournament-detail?contact=13800138000" },
  });
  assert.equal(routed.source.sourceRef.sanitizedRoute, "app:tournament-detail?contact=[redacted]");
  assert.ok(routed.coverage.warnings.includes("sensitive_value_redacted:sourceRef.sanitizedRoute:phone_number"));

  const market = fixture("capture/market-visible-viewport-v2.json");
  market.data.query.searchLabel = "代购 13900001111";
  market.data.rows[0].rawCardLabel = `${market.data.rows[0].rawCardLabel} 微信 shopowner_x`;
  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(market)), context);
  assert.equal(JSON.stringify(snapshot).includes("13900001111"), false);
  assert.equal(JSON.stringify(snapshot).includes("shopowner_x"), false);
  assert.equal(snapshot.data.query.searchLabel, "代购 [redacted]");
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.query.searchLabel:phone_number"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.rows[0].rawCardLabel:contact_id"));
});

/* ------------------------------------------------------------------------------------- *
 * I-2 (final fix wave) -- a sensitive provider event id is redacted AT BIRTH
 * ------------------------------------------------------------------------------------- */

test("I-2: a phone-shaped provider event id never reaches the id stem, the body, or the event key", () => {
  const snapshot = screenedTournamentSnapshot({}, {
    sourceRef: { providerEventId: "13800138000", sanitizedRoute: "app:tournament-detail" },
  });
  assert.equal(JSON.stringify(snapshot).includes("13800138000"), false);
  assert.equal(snapshot.source.sourceRef.providerEventId, "redacted");
  assert.match(snapshot.snapshotId, /^jihuanshe-tournament-redacted-[0-9a-f]{16}$/u);
  // The event key falls back to the (already value-screened) identity fields, so two captures of
  // the same event still dedupe against each other without the provider id being hashed anywhere.
  assert.match(snapshot.data.eventKey, /^jihuanshe:tournament:fallback:sha256:[0-9a-f]{64}$/u);
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:sourceRef.providerEventId:phone_number"));
});

test("I-2: the redacted form is irreversible BY CONSTRUCTION -- no published value is a function of the id", () => {
  // Two captures that differ ONLY in a sensitive provider event id produce the SAME evidence
  // identity: same eventKey, same eventEvidenceHash, same id stem, same body. The raw id is never
  // hashed, encoded or stored, so there is no preimage to brute-force -- unlike a hash OF the id,
  // which is 64 unsalted bits over a fully known 11-digit template.
  const first = screenedTournamentSnapshot({}, {
    sourceRef: { providerEventId: "13800138000", sanitizedRoute: "app:tournament-detail" },
  });
  const second = screenedTournamentSnapshot({}, {
    sourceRef: { providerEventId: "13911112222", sanitizedRoute: "app:tournament-detail" },
  });
  assert.equal(first.data.eventKey, second.data.eventKey);
  assert.equal(first.data.eventEvidenceHash, second.data.eventEvidenceHash);
  assert.deepEqual(
    { ...first, snapshotId: null, contentHash: null, source: { ...first.source, captureHash: null } },
    { ...second, snapshotId: null, contentHash: null, source: { ...second.source, captureHash: null } },
  );
  // The three fields that DO differ all derive from `source.captureHash`, which is a digest of the
  // entire raw capture envelope -- including the joinTokens this module deliberately never
  // publishes -- and not of the provider id. It is not attackable from the published artifact the
  // way a digest of an 11-digit template is.
  assert.notEqual(first.source.captureHash, second.source.captureHash);
  assert.equal(first.snapshotId.slice(0, -16), second.snapshotId.slice(0, -16));
  assert.equal(first.snapshotId.slice(0, -16), "jihuanshe-tournament-redacted-");

  // ...and an ORDINARY provider id is still used verbatim, so this is a screen and not a blanket.
  const ordinary = screenedTournamentSnapshot({});
  assert.equal(ordinary.source.sourceRef.providerEventId, "fixture-event-001");
  assert.equal(ordinary.data.eventKey, "jihuanshe:tournament:fixture-event-001");
  assert.match(ordinary.snapshotId, /^jihuanshe-tournament-fixture-event-001-[0-9a-f]{16}$/u);
});

test("I-2: a provider event id outside the safe identifier charset is redacted too", () => {
  for (const hostile of ["../../etc/passwd", "组织者 张三", "a".repeat(65), "QQ87654321"]) {
    const snapshot = screenedTournamentSnapshot({}, {
      sourceRef: { providerEventId: hostile, sanitizedRoute: "app:tournament-detail" },
    });
    assert.equal(snapshot.source.sourceRef.providerEventId, "redacted", hostile);
    assert.match(snapshot.snapshotId, /^jihuanshe-tournament-redacted-[0-9a-f]{16}$/u, hostile);
  }
});

test("I-1: EVERY free-text identity label is screened, one field at a time", () => {
  // Dropping a single field out of the screen list is the cheapest way to reintroduce this leak, so
  // each one is probed on its own rather than inferred from the composite probe above.
  for (const field of ["title", "status", "formatLabel", "participantCountLabel", "organizerLabel", "locationLabel"]) {
    const snapshot = screenedTournamentSnapshot({ [field]: `联系 13800138000 ${field}` });
    assert.equal(snapshot.data.identity[field], `联系 [redacted] ${field}`, field);
    assert.ok(
      snapshot.coverage.warnings.includes(`sensitive_value_redacted:data.identity.${field}:phone_number`),
      field,
    );
  }
});

test("I-1: startLabel is screened so a malformed one cannot echo an identifier into the error", () => {
  // `startLabel` is the one identity label whose VALUE can never reach the published body carrying
  // free text -- buildEventTime hard-rejects anything that is not a local date or an RFC 3339
  // timestamp. Its screening is still reachable, and still worth keeping, on the ERROR path: the
  // rejection message quotes the label back, and this module already redacts sensitive values out
  // of its own error messages (see the joinToken duplicate-detection rule).
  let error;
  try {
    screenedTournamentSnapshot({ startLabel: "开赛 13800138000" });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof EnvironmentError);
  assert.equal(error.code, "normalization_failed");
  assert.equal(String(error.message).includes("13800138000"), false);
  assert.ok(String(error.message).includes("[redacted]"));
});

test("I-1: spaced, hyphenated and full-width CN mobiles are redacted in place; names survive", () => {
  // Compact 11-digit is already pinned above. These three shapes reached the published body
  // verbatim before the phone span learned separators and full-width digits. A personal name
  // has no shape, so 张伟 stays -- this is still an identifier screen, not an identity screen.
  const shapes = [
    { raw: "138 0013 8000", field: "title" },
    { raw: "138-0013-8000", field: "organizerLabel" },
    { raw: "１３８００１３８０００", field: "locationLabel" },
  ];
  for (const { raw, field } of shapes) {
    const snapshot = screenedTournamentSnapshot({ [field]: `主办人张伟 ${raw} 深圳` });
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes(raw), false, raw);
    assert.equal(snapshot.data.identity[field], "主办人张伟 [redacted] 深圳", raw);
    assert.ok(
      snapshot.coverage.warnings.includes(`sensitive_value_redacted:data.identity.${field}:phone_number`),
      raw,
    );
  }
});

test("I-1: an e-mail address is redacted IN PLACE and names its own shape", () => {
  // The email_address rule has been in SENSITIVE_VALUE_SPANS since I-1; the composite probe
  // never put an address in any field, so deleting the rule left the suite green. This one
  // would have failed before the rule existed.
  const snapshot = screenedTournamentSnapshot({
    organizerLabel: "李娜 (alice.organizer+sc@example.com)",
    title: "上海周赛 主办人张伟",
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("alice.organizer+sc@example.com"), false);
  assert.equal(snapshot.data.identity.organizerLabel, "李娜 ([redacted])");
  assert.equal(snapshot.data.identity.title, "上海周赛 主办人张伟");
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.identity.organizerLabel:email_address"));
});

test("I-1: rawArchetypeLabel on results, entrant and distribution rows is value-screened", () => {
  const envelope = fixture("capture/tournament-full-field-v2.json");
  envelope.data.results.rows[0].rawArchetypeLabel = "合成红艾斯 138 0013 8000";
  envelope.data.decks.entrantRows[1].rawArchetypeLabel = "合成黑黄蒂奇 联系 alice@example.com";
  envelope.data.decks.distributionRows[0].rawArchetypeLabel = "合成红艾斯 Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(envelope)), context);
  const serialized = JSON.stringify(snapshot);

  for (const secret of ["138 0013 8000", "alice@example.com", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(snapshot.data.evidenceBlocks.results.rows[0].rawArchetypeLabel, "合成红艾斯 [redacted]");
  assert.ok(snapshot.data.evidenceBlocks.field.unresolvedLabels.includes("合成黑黄蒂奇 联系 [redacted]"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.results.rows[0].rawArchetypeLabel:phone_number"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.decks.entrantRows[1].rawArchetypeLabel:email_address"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.decks.distributionRows[0].rawArchetypeLabel:credential"));
});

test("I-1: market row language, condition and grade labels are value-screened", () => {
  const market = fixture("capture/market-visible-viewport-v2.json");
  market.data.rows[0].languageLabel = "简体中文 138-0013-8000";
  market.data.rows[0].conditionLabel = "全新 微信 shopowner_x";
  market.data.rows[1].gradeLabel = "未评级 alice@example.com";
  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(market)), context);
  const serialized = JSON.stringify(snapshot);

  for (const secret of ["138-0013-8000", "shopowner_x", "alice@example.com"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(snapshot.data.rows[0].languageLabel, "简体中文 [redacted]");
  assert.equal(snapshot.data.rows[0].conditionLabel, "全新 微信 [redacted]");
  assert.equal(snapshot.data.rows[1].gradeLabel, "未评级 [redacted]");
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.rows[0].languageLabel:phone_number"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.rows[0].conditionLabel:contact_id"));
  assert.ok(snapshot.coverage.warnings.includes("sensitive_value_redacted:data.rows[1].gradeLabel:email_address"));
});
