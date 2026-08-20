import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EnvironmentError } from "../environment/errors.mjs";
import { verifySnapshot } from "../environment/snapshot.mjs";
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
  assert.equal(snapshot.data.evidenceBlocks.field.sampleFrame, "full-field");
  assert.equal(snapshot.data.evidenceBlocks.field.denominator.value, 4);
  assert.equal(snapshot.data.evidenceBlocks.field.unresolvedParticipants, 0);
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

test("batch and single-event captures share event identity and evidence hash", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  const batch = {
    ...source,
    surface: "tournament-batch",
    data: { events: [source.data] },
  };
  const [single] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(source)), context);
  const [batched] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(batch)), context);

  assert.equal(single.data.eventKey, batched.data.eventKey);
  assert.equal(single.data.eventEvidenceHash, batched.data.eventEvidenceHash);
  assert.equal(single.kind, batched.kind);
});

test("top-cut and unresolved mappings publish incomplete source evidence only", () => {
  const topCut = normalizeJiHuanSheCapture(
    fixtureBytes("capture/tournament-top-cut-v2.json"),
    context,
  )[0];
  assert.equal(topCut.coverage.status, "partial");
  assert.equal(topCut.data.evidenceBlocks.field.sampleFrame, "top-cut");
  assert.equal(topCut.data.evidenceBlocks.field.coverage.status, "partial");

  const unresolvedMapping = { ...mapping, entries: {} };
  const unresolved = normalizeJiHuanSheCapture(
    fixtureBytes("capture/tournament-full-field-v2.json"),
    { ...context, mapping: unresolvedMapping },
  )[0];
  assert.equal(unresolved.coverage.status, "partial");
  assert.equal(unresolved.data.evidenceBlocks.field.sampleFrame, "unknown");
  assert.ok(unresolved.data.evidenceBlocks.field.unresolvedLabels.length > 0);
  assert.equal(unresolved.data.evidenceBlocks.field.coverage.status, "partial");
});

test("ambiguous fallback event identity is rejected", () => {
  assert.throws(
    () => normalizeJiHuanSheCapture(fixtureBytes("capture/tournament-ambiguous-v2.json"), context),
    (error) => error instanceof EnvironmentError && error.code === "event_identity_ambiguous",
  );
});

test("percentage rounding and duplicate rows fail closed", () => {
  const source = fixture("capture/tournament-full-field-v2.json");
  source.data.decks.distributionRows[0].percentageLabel = "49%";
  assert.throws(
    () => normalizeTournamentCapture(source, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(source))) }),
    (error) => error instanceof EnvironmentError && error.code === "field_not_representative",
  );

  const duplicate = fixture("capture/tournament-full-field-v2.json");
  duplicate.data.results.rows[1].rank = 1;
  assert.throws(
    () => normalizeTournamentCapture(duplicate, { ...context, captureHash: captureHash(Buffer.from(JSON.stringify(duplicate))) }),
    (error) => error instanceof EnvironmentError && error.code === "normalization_failed",
  );
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
