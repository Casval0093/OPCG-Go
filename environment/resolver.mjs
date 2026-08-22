// Fail-closed environment resolution.
//
// The resolver is READ-ONLY: it never publishes, mutates, or acquires
// anything. It turns an alias (or an immutable Manifest ID plus its full hash)
// and a candidate DeckSnapshot into the concrete boundary later simulation
// tasks consume, and it validates in ONE fixed order so that a given
// repository state always produces the same first failure.

import { EnvironmentError } from "./errors.mjs";
import { evaluateCapabilityGate } from "./capability.mjs";
import { evaluateClockGate } from "./clock.mjs";
import { validateDeckLegality } from "./legality.mjs";
import { freshnessAgeDays } from "./time.mjs";
import {
  createRepository,
  isFullHash,
  isRfc3339Instant,
  isSafeArtifactId,
  manifestPath,
  parseEnvironmentSelector,
  readAliasRecord,
  readArtifactAt,
} from "./alias.mjs";
import {
  MANIFEST_ARTIFACT_CONTRACT,
  REFERENCE_KINDS,
  loadReferencedArtifact,
} from "./manifest.mjs";

// The plan's fixed validation order. Failures are labelled with the stage that
// produced them, so an earlier defect always masks a later one deterministically.
export const RESOLVER_STAGES = Object.freeze([
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

// The stable machine-readable failure codes this resolver can emit. The plan
// names the first sixteen; the remainder are this module's own and are equally
// stable. `resolver_failed` is the wrapper applied when a NON-EnvironmentError
// escapes a stage -- it should never be observed, but it keeps the serialized
// contract total rather than letting an unexpected throw escape untyped.
export const RESOLVER_ERROR_CODES = Object.freeze([
  "environment_not_found",
  "snapshot_hash_mismatch",
  "snapshot_id_collision",
  "environment_identity_mismatch",
  "stale_latest",
  "field_not_representative",
  "duplicate_event",
  "unresolved_mapping",
  "illegal_deck",
  "card_pool_unverified",
  "card_rules_identity_mismatch",
  "simulation_not_ready",
  "simulation_result_mismatch",
  "missing_representative_deck",
  "insufficient_matchup_coverage",
  "clock_model_unavailable",
  "manifest_invalid",
  "legacy_evidence_rejected",
  "resolver_input_invalid",
  "resolver_failed",
]);

const INPUT_KEYS = Object.freeze(["selector", "candidateDeckRef", "now", "allowDiagnostic"]);
const WEIGHT_TOLERANCE = 1e-12;
const SEATS = Object.freeze(["play", "draw"]);
const MAX_DETAIL_STRING = 200;
const MAX_DETAIL_ITEMS = 32;
const MAX_DETAIL_DEPTH = 4;

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, details) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function failStage(stage, code, message, path, details = {}) {
  fail(code, message, { stage, path, ...details });
}

function stampStage(error, stage, path) {
  if (!(error instanceof EnvironmentError)) {
    return new EnvironmentError(
      "resolver_failed",
      `resolver_failed: ${String(error?.message ?? error)}`,
      { stage, path },
    );
  }
  const details = isRecord(error.details) ? error.details : {};
  if (details.stage === undefined) {
    error.details = { ...details, stage, path: details.path ?? path };
  }
  return error;
}

function runStage(stage, path, fn) {
  try {
    return fn();
  } catch (error) {
    throw stampStage(error, stage, path);
  }
}

/* ------------------------------------------------------------------ *
 * Safe failure serialization
 * ------------------------------------------------------------------ */

function looksLikeFilesystemPath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

function sanitizeDetail(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value) || typeof value === "boolean" ? value : String(value);
  }
  if (typeof value === "string") {
    // An absolute filesystem path is repository-private and is never part of a
    // machine-readable failure contract.
    if (looksLikeFilesystemPath(value)) return "[redacted-path]";
    return value.length > MAX_DETAIL_STRING ? `${value.slice(0, MAX_DETAIL_STRING)}...` : value;
  }
  if (depth >= MAX_DETAIL_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ITEMS).map((item) => sanitizeDetail(item, depth + 1));
  }
  if (isRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_ITEMS)) {
      if (key === "stage" || key === "path") continue;
      result[key] = sanitizeDetail(item, depth + 1);
    }
    return result;
  }
  return undefined;
}

export function resolverErrorJson(error) {
  const details = isRecord(error?.details) ? error.details : {};
  const stage = RESOLVER_STAGES.includes(details.stage) ? details.stage : RESOLVER_STAGES[0];
  const path = typeof details.path === "string" && !looksLikeFilesystemPath(details.path)
    ? details.path
    : "";
  return {
    status: "error",
    code: typeof error?.code === "string" ? error.code : "resolver_failed",
    stage,
    path,
    details: sanitizeDetail(details) ?? {},
  };
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

// The injected instant, expressed as a calendar date in the environment's own
// timezone. Every interval comparison downstream is date-only, and a native SC
// (Asia/Shanghai) environment near local midnight has a UTC date one day
// behind, so comparing a raw UTC instant would key the check to the wrong day.
function localDateOf(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = {};
  for (const part of parts) {
    if (part.type !== "literal") value[part.type] = part.value;
  }
  return `${String(value.year).padStart(4, "0")}-${value.month}-${value.day}`;
}

// Fractional 24-hour days from the END of a day-precision local date to the
// injected instant. Evidence dated today (or later) is age 0 rather than an
// error: `freshnessAgeDays` refuses future evidence, and resolving on the same
// local day the evidence is dated is normal.
function evidenceAgeDays(localDate, timeZone, nowInstant, localNowDate) {
  if (localDate >= localNowDate) return 0;
  return freshnessAgeDays({ precision: "day", localDate, timeZone }, nowInstant);
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

function readInput(input) {
  if (!isRecord(input)) {
    fail("resolver_input_invalid", "resolver input must be an object", {});
  }
  const unexpected = Object.keys(input).filter((key) => !INPUT_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("resolver_input_invalid", "resolver input contains unsupported fields", { unexpected });
  }
  // The library NEVER reads host clock time. A caller that omits `now` fails
  // closed; defaulting belongs at a command boundary, outside this library.
  if (!isRfc3339Instant(input.now)) {
    fail("resolver_input_invalid", "resolver requires an explicit RFC 3339 now instant", {
      reason: "now_not_provided",
    });
  }
  const ref = input.candidateDeckRef;
  if (
    !isRecord(ref)
    || Object.keys(ref).length !== 2
    || !isSafeArtifactId(ref.snapshotId)
    || !isFullHash(ref.contentHash)
  ) {
    fail("resolver_input_invalid", "candidateDeckRef must be exactly { snapshotId, contentHash }", {});
  }
  if (input.allowDiagnostic !== undefined && typeof input.allowDiagnostic !== "boolean") {
    fail("resolver_input_invalid", "allowDiagnostic must be a boolean", {});
  }
  return {
    selector: input.selector,
    candidateDeckRef: { snapshotId: ref.snapshotId, contentHash: ref.contentHash },
    now: input.now,
    allowDiagnostic: input.allowDiagnostic === true,
  };
}

/* ------------------------------------------------------------------ *
 * Field evidence
 * ------------------------------------------------------------------ */

function validateFieldEvidence(field, manifest, archetypeIndex) {
  const data = field.data;
  if (!isRecord(data)) {
    failStage("field", "field_not_representative", "field snapshot has no data", "references.field");
  }
  if (field.coverage?.status !== "complete" || data.coverage?.status !== "complete") {
    failStage("field", "field_not_representative", "field evidence coverage is not complete", "references.field", {
      envelopeStatus: field.coverage?.status,
      dataStatus: data.coverage?.status,
    });
  }
  if (field.asOf !== manifest.asOf || data.window?.asOf !== manifest.asOf) {
    failStage("field", "environment_identity_mismatch", "field evidence is not dated at the Manifest asOf", "references.field", {
      reason: "field_as_of_mismatch",
      manifestAsOf: manifest.asOf,
      fieldAsOf: field.asOf,
      windowAsOf: data.window?.asOf,
    });
  }
  // v1 NARROWING, widening site 3 of 3 (see environment/manifest.mjs
  // validateAllReferences): a proxy Manifest may borrow a cross-edition PRIOR
  // but not a cross-edition FIELD, so the field window must be stated in this
  // environment's own timezone.
  if (data.window?.timeZone !== manifest.timeZone) {
    failStage("field", "environment_identity_mismatch", "field window timezone differs from the environment", "references.field", {
      reason: "field_window_timezone_mismatch",
      manifestTimeZone: manifest.timeZone,
      windowTimeZone: data.window?.timeZone,
    });
  }
  const total = data.totalParticipants;
  const classified = data.classifiedParticipants;
  const unclassified = data.unclassifiedParticipants;
  const covered = data.coveredParticipants;
  for (const [key, value] of [["totalParticipants", total], ["classifiedParticipants", classified], ["unclassifiedParticipants", unclassified], ["coveredParticipants", covered]]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      failStage("field", "field_not_representative", "field participant counts are not integers", "references.field", { key, value });
    }
  }
  if (total <= 0) {
    failStage("field", "field_not_representative", "field evidence has no participants", "references.field");
  }
  if (unclassified !== 0) {
    failStage("field", "field_not_representative", "field evidence contains unclassified participants", "references.field", {
      reason: "unclassified_participants",
      unclassifiedParticipants: unclassified,
    });
  }
  if (classified !== total || covered !== total) {
    failStage("field", "field_not_representative", "field participant counts do not reconcile", "references.field", {
      reason: "participant_counts_unreconciled",
      totalParticipants: total,
      classifiedParticipants: classified,
      coveredParticipants: covered,
    });
  }
  if (covered / total < manifest.matchupPolicy.requiredFieldCoverage) {
    failStage("field", "field_not_representative", "field coverage is below the Manifest requirement", "references.field");
  }

  const events = data.selectedEvents;
  if (!Array.isArray(events) || events.length === 0) {
    failStage("field", "field_not_representative", "field evidence names no selected events", "references.field");
  }
  const eventKeys = new Set();
  for (const event of events) {
    if (!isRecord(event) || typeof event.eventKey !== "string" || event.eventKey.length === 0) {
      failStage("field", "field_not_representative", "a selected event has no event key", "references.field");
    }
    if (eventKeys.has(event.eventKey)) {
      failStage("field", "duplicate_event", "field evidence selects one event key twice", "references.field", {
        eventKey: event.eventKey,
      });
    }
    eventKeys.add(event.eventKey);
  }

  const archetypes = data.archetypes;
  if (!Array.isArray(archetypes) || archetypes.length === 0) {
    failStage("field", "field_not_representative", "field evidence has no archetype rows", "references.field");
  }
  const seen = new Set();
  for (const row of archetypes) {
    if (!isRecord(row) || typeof row.archetypeId !== "string" || row.archetypeId.length === 0) {
      failStage("field", "unresolved_mapping", "a field row has no canonical archetype", "references.field");
    }
    if (seen.has(row.archetypeId)) {
      failStage("field", "field_not_representative", "field evidence repeats one archetype", "references.field", {
        archetypeId: row.archetypeId,
      });
    }
    seen.add(row.archetypeId);
    if (typeof row.share !== "number" || !Number.isFinite(row.share) || row.share <= 0) {
      failStage("field", "field_not_representative", "a field share is not a positive number", "references.field", {
        archetypeId: row.archetypeId,
      });
    }
    // Missing shares are never renormalized: every archetype the field
    // actually contains must have a representative deck in the Manifest.
    if (!archetypeIndex.has(row.archetypeId)) {
      failStage("field", "missing_representative_deck", "a field archetype has no representative deck", "references.field", {
        archetypeId: row.archetypeId,
      });
    }
  }
  return archetypes;
}

/* ------------------------------------------------------------------ *
 * Matchup evidence
 * ------------------------------------------------------------------ */

function cellKey(opponentGameplayHash, seat) {
  return `${opponentGameplayHash}|${seat}`;
}

function assertScoreableMatchup(snapshot, { manifest, path, candidateGameplayHash, requiredKeys }) {
  const data = snapshot.data;
  if (!isRecord(data)) {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence has no data", path);
  }
  if (data.method !== "observed" && data.method !== "simulated") {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence declares no method", path, {
      method: data.method,
    });
  }
  if (data.applicability !== "native" && data.applicability !== "proxy") {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence declares no applicability", path, {
      applicability: data.applicability,
    });
  }
  if (typeof data.population !== "string" || data.population.length === 0) {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence names no population", path);
  }
  if (!isRecord(data.window) || typeof data.window.startLocalDate !== "string" || typeof data.window.asOf !== "string") {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence names no observation window", path);
  }
  const round = manifest.matchupPolicy.roundPolicy;
  if (
    !isRecord(data.roundPolicy)
    || data.roundPolicy.stage !== round.stage
    || data.roundPolicy.roundDurationMinutes !== round.roundDurationMinutes
    || data.roundPolicy.timeoutScoring !== round.timeoutScoring
  ) {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence does not match the Manifest round policy", path, {
      expected: round.stage,
      actual: data.roundPolicy?.stage,
    });
  }
  if (!Array.isArray(data.cells) || data.cells.length === 0) {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence contains no scoreable cells", path, {
      reason: "no_scoreable_cells",
    });
  }

  const floor = manifest.matchupPolicy.minimumGamesPerSeat;
  const covered = new Set();
  data.cells.forEach((cell, index) => {
    const cellPath = `${path}.cells[${index}]`;
    if (!isRecord(cell)) {
      failStage("evidence", "insufficient_matchup_coverage", "a matchup cell is not an object", cellPath);
    }
    for (const key of [
      "candidateDeckSnapshotId", "candidateContentHash", "candidateGameplayHash",
      "opponentDeckSnapshotId", "opponentContentHash", "opponentGameplayHash",
    ]) {
      const value = cell[key];
      const ok = key.endsWith("Hash") ? isFullHash(value) : isSafeArtifactId(value);
      if (!ok) {
        failStage("evidence", "insufficient_matchup_coverage", "a matchup cell does not identify both decks exactly", cellPath, { key });
      }
    }
    if (!SEATS.includes(cell.candidateSeat)) {
      failStage("evidence", "insufficient_matchup_coverage", "a matchup cell has no play/draw seat", cellPath, {
      reason: "missing_seat",
    });
    }
    for (const key of ["wins", "losses", "scoredRoundTimeouts", "validGames"]) {
      if (!Number.isSafeInteger(cell[key]) || cell[key] < 0) {
        failStage("evidence", "insufficient_matchup_coverage", "a matchup cell exposes no outcome denominator", cellPath, {
          reason: "missing_outcome_counts",
          key,
        });
      }
    }
    if (cell.wins + cell.losses + cell.scoredRoundTimeouts !== cell.validGames) {
      failStage("evidence", "insufficient_matchup_coverage", "a matchup cell's outcome counts do not reconcile", cellPath, {
        reason: "outcome_counts_inconsistent",
        validGames: cell.validGames,
      });
    }
    if (cell.validGames < floor) {
      failStage("evidence", "insufficient_matchup_coverage", "a matchup cell is below the per-seat completed-game floor", cellPath, {
        reason: "below_per_seat_floor",
        validGames: cell.validGames,
        floor,
      });
    }
    if (cell.candidateGameplayHash === candidateGameplayHash) {
      covered.add(cellKey(cell.opponentGameplayHash, cell.candidateSeat));
    }
  });

  const missing = [...requiredKeys].filter((key) => !covered.has(key));
  if (missing.length > 0) {
    failStage("evidence", "insufficient_matchup_coverage", "matchup evidence does not cover every representative and seat", path, {
      reason: "incomplete_seat_coverage",
      missingCells: missing.length,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

function freezeDeep(value, active = new Set()) {
  if (value === null || typeof value !== "object" || active.has(value)) return value;
  active.add(value);
  try {
    for (const child of Object.values(value)) freezeDeep(child, active);
    return Object.freeze(value);
  } finally {
    active.delete(value);
  }
}

export function resolveEnvironment(input, repository) {
  const warnings = [];
  const blockers = [];
  let degraded = false;

  /* -- 1. selector and alias ------------------------------------- */
  const { repo, request, selector, aliasRecord } = runStage("selector", "selector", () => {
    const parsedInput = readInput(input);
    const resolvedRepository = createRepository(repository);
    const parsedSelector = parseEnvironmentSelector(parsedInput.selector);
    const record = parsedSelector.mode === "alias"
      ? readAliasRecord(resolvedRepository, parsedSelector.aliasName).record
      : null;
    return {
      repo: resolvedRepository,
      request: parsedInput,
      selector: parsedSelector,
      aliasRecord: record,
    };
  });

  const requestedManifestId = selector.mode === "alias" ? aliasRecord.manifestId : selector.manifestId;
  const expectedManifestHash = selector.mode === "alias" ? aliasRecord.manifestHash : selector.contentHash;

  /* -- 2. Manifest hash ------------------------------------------ */
  const manifest = runStage("manifest", "manifestRef", () => {
    const target = manifestPath(repo.root, requestedManifestId);
    const read = readArtifactAt(repo, target, MANIFEST_ARTIFACT_CONTRACT);
    if (!read.ok) {
      if (read.reason === "absent") {
        fail("environment_not_found", "no Manifest is published under this immutable identifier", {
          manifestId: requestedManifestId,
        });
      }
      throw read.error;
    }
    const value = read.value;
    if (value.manifestId !== requestedManifestId) {
      fail("snapshot_id_collision", "the published Manifest does not carry the requested identifier", {
        manifestId: requestedManifestId,
      });
    }
    if (value.contentHash !== expectedManifestHash) {
      fail("snapshot_hash_mismatch", "the Manifest does not match the full hash the selector pinned", {
        expected: expectedManifestHash,
        actual: value.contentHash,
      });
    }
    return value;
  });

  const identity = {
    edition: manifest.edition,
    metagameRegion: manifest.metagameRegion,
    language: manifest.language,
    formatId: manifest.formatId,
    timeZone: manifest.timeZone,
  };
  const policy = manifest.matchupPolicy;

  /* -- 3. native identity combination ----------------------------- */
  runStage("identity", "manifestRef", () => {
    // The Manifest's own identity is validated by verifyManifest at stage 2.
    // What only this stage can check is the relationship between the SELECTOR
    // and the Manifest: SC/latest can never serve an EN Manifest, and an
    // official alias can never serve a proxy Manifest.
    if (selector.mode !== "alias") return;
    if (selector.edition !== manifest.edition || selector.kind !== manifest.kind) {
      fail("environment_identity_mismatch", "the alias does not match the Manifest's edition and kind", {
        alias: selector.alias,
        aliasEdition: selector.edition,
        aliasKind: selector.kind,
        manifestEdition: manifest.edition,
        manifestKind: manifest.kind,
      });
    }
  });

  /* -- 4. asOf and freshness -------------------------------------- */
  runStage("freshness", "asOf", () => {
    const localNow = localDateOf(request.now, manifest.timeZone);
    if (manifest.asOf > localNow) {
      fail("environment_identity_mismatch", "the Manifest asOf is later than the injected clock", {
        asOf: manifest.asOf,
        localNow,
      });
    }
    // Freshness is an ALIAS policy. An explicit historical Manifest stays
    // reproducible forever; `latest` is the only thing that can go stale.
    if (selector.mode !== "alias") return;
    const fieldAge = evidenceAgeDays(manifest.asOf, manifest.timeZone, request.now, localNow);
    if (fieldAge > manifest.latestPolicy.fieldMaxAgeDays) {
      fail("stale_latest", "the aliased field evidence is older than the latest-freshness policy", {
        path: "references.field",
        ageDays: fieldAge,
        fieldMaxAgeDays: manifest.latestPolicy.fieldMaxAgeDays,
      });
    }
    manifest.references.market.forEach((ref, index) => {
      const path = `references.market[${index}]`;
      let market;
      try {
        market = loadReferencedArtifact(repo, ref, { kind: "market", path, identity });
      } catch (error) {
        // Market evidence is optional and strength-inert: an unreadable or
        // absent market artifact is reported, never fatal.
        warnings.push({
          code: "market_unavailable",
          path,
          cause: error instanceof EnvironmentError ? error.code : "unreadable",
        });
        return;
      }
      const age = evidenceAgeDays(market.asOf, manifest.timeZone, request.now, localNow);
      if (age <= manifest.latestPolicy.marketMaxAgeDays) return;
      if (manifest.latestPolicy.marketStalenessBlocksStrength) {
        fail("stale_latest", "market evidence is stale and this Manifest makes that blocking", {
          path,
          ageDays: age,
          marketMaxAgeDays: manifest.latestPolicy.marketMaxAgeDays,
        });
      }
      warnings.push({
        code: "market_stale",
        path,
        ageDays: age,
        marketMaxAgeDays: manifest.latestPolicy.marketMaxAgeDays,
      });
    });
  });

  /* -- 5. rules, card pool, banlist, construction ------------------ */
  const references = runStage("references", "references", () => {
    const loaded = {};
    for (const key of ["rules", "cardPool", "banlist", "constructionPolicy"]) {
      loaded[key] = loadReferencedArtifact(repo, manifest.references[key], {
        kind: REFERENCE_KINDS[key],
        path: `references.${key}`,
        identity,
      });
    }
    return loaded;
  });

  /* -- 6. candidate and representative DeckSnapshots --------------- */
  const decks = runStage("decks", "candidateDeckRef", () => {
    const legalityDeps = {
      environment: { ...identity, asOf: manifest.asOf },
      rules: references.rules,
      cardPool: references.cardPool,
      banlist: references.banlist,
      construction: references.constructionPolicy,
    };
    const candidate = loadReferencedArtifact(repo, request.candidateDeckRef, {
      kind: "deck",
      path: "candidateDeckRef",
      editionNeutral: true,
    });
    try {
      validateDeckLegality({ ...legalityDeps, deck: candidate });
    } catch (error) {
      throw stampStage(error, "decks", "candidateDeckRef");
    }

    const representatives = manifest.opponents.map((entry, index) => ({
      archetypeId: entry.archetypeId,
      decks: entry.representativeDecks.map((deckEntry, deckIndex) => {
        const path = `opponents[${index}].representativeDecks[${deckIndex}]`;
        const deck = loadReferencedArtifact(
          repo,
          { snapshotId: deckEntry.deckSnapshotId, contentHash: deckEntry.contentHash },
          { kind: "deck", path, editionNeutral: true, absentCode: "missing_representative_deck" },
        );
        if (deck.data?.gameplayHash !== deckEntry.gameplayHash) {
          failStage("decks", "illegal_deck", "a representative deck's pinned gameplay hash does not match its contents", path);
        }
        try {
          validateDeckLegality({ ...legalityDeps, deck });
        } catch (error) {
          throw stampStage(error, "decks", path);
        }
        return { entry: deckEntry, snapshot: deck };
      }),
    }));
    return { candidate, representatives };
  });

  const archetypeIndex = new Map(decks.representatives.map((row) => [row.archetypeId, row]));

  /* -- 7. field completeness --------------------------------------- */
  const archetypes = runStage("field", "references.field", () => {
    // v1 NARROWING, widening site 2 of 3 (see environment/manifest.mjs
    // validateAllReferences): `identity` here is what forbids a proxy Manifest
    // from pointing at a cross-edition field.
    const field = loadReferencedArtifact(repo, manifest.references.field, {
      kind: "field",
      path: "references.field",
      identity,
    });
    return validateFieldEvidence(field, manifest, archetypeIndex);
  });

  /* -- 8. observed / proxy evidence contract ----------------------- */
  const candidateGameplayHash = decks.candidate.data.gameplayHash;
  const requiredCells = new Set();
  for (const row of decks.representatives) {
    for (const representative of row.decks) {
      for (const seat of SEATS) requiredCells.add(cellKey(representative.entry.gameplayHash, seat));
    }
  }
  const matchupEvidence = runStage("evidence", "matchupPolicy", () => {
    const applicability = manifest.kind === "proxy" ? "proxy" : "native";
    const refs = [];
    if (policy.proxyPriorRef !== null) {
      const path = "matchupPolicy.proxyPriorRef";
      const prior = loadReferencedArtifact(
        repo,
        { snapshotId: policy.proxyPriorRef.snapshotId, contentHash: policy.proxyPriorRef.contentHash },
        { kind: "matchup", path, crossEdition: policy.proxyPriorRef.originEdition },
      );
      assertScoreableMatchup(prior, {
        manifest,
        path,
        candidateGameplayHash,
        requiredKeys: requiredCells,
      });
      refs.push({ snapshotId: prior.snapshotId, contentHash: prior.contentHash });
    }
    if (policy.mode === "observed") {
      if (policy.observedMatchupRefs.length === 0) {
        fail("insufficient_matchup_coverage", "observed mode requires an immutable matchup reference", {
          path: "matchupPolicy.observedMatchupRefs",
        });
      }
      policy.observedMatchupRefs.forEach((ref, index) => {
        const path = `matchupPolicy.observedMatchupRefs[${index}]`;
        const observed = loadReferencedArtifact(repo, ref, { kind: "matchup", path, identity });
        assertScoreableMatchup(observed, {
          manifest,
          path,
          candidateGameplayHash,
          requiredKeys: requiredCells,
        });
        refs.push({ snapshotId: observed.snapshotId, contentHash: observed.contentHash });
      });
      // Observed mode is scored from evidence that already exists, so no
      // simulation job is ever emitted for it.
      return { method: "observed", applicability, refs };
    }
    return { method: "simulated", applicability, refs };
  });

  /* -- 9. capability gate ------------------------------------------ */
  const capability = runStage("capability", "references.simulationCapability", () => {
    const snapshot = loadReferencedArtifact(repo, manifest.references.simulationCapability, {
      kind: "simulation-capability",
      path: "references.simulationCapability",
      identity,
    });
    const deckSnapshots = [
      decks.candidate,
      ...decks.representatives.flatMap((row) => row.decks.map((representative) => representative.snapshot)),
    ];
    // A gameplay ID the engine cannot execute is never diagnostic-ready: the
    // measurement literally cannot be run, so explicit diagnostic permission
    // does not rescue it. Only an OPEN reviewed limitation degrades to
    // diagnostic_estimate.
    const gate = evaluateCapabilityGate(snapshot, deckSnapshots);
    if (gate.mode !== "official") {
      if (!request.allowDiagnostic) {
        fail("simulation_not_ready", "the capability gate is closed and diagnostics were not requested", {
          blockers: gate.blockers.map((row) => row.code),
        });
      }
      degraded = true;
      blockers.push(...gate.blockers.map((row) => ({
        code: row.code,
        affectedCapability: row.affectedCapability,
        evidenceLocation: row.evidenceLocation,
      })));
    }
    return snapshot;
  });

  /* -- 10. clock gate ---------------------------------------------- */
  const clock = runStage("clock", "matchupPolicy.roundPolicy.clockModelRef", () => {
    const ref = policy.roundPolicy.clockModelRef;
    const path = "matchupPolicy.roundPolicy.clockModelRef";
    const unavailable = (reason, cause) => {
      if (!request.allowDiagnostic) {
        fail("clock_model_unavailable", "no accepted clock model authorizes this environment's round timeout", {
          path,
          reason,
          cause,
        });
      }
      degraded = true;
      blockers.push({ code: "clock_model_unavailable", reason, cause });
      return { ref: null, roundTimeoutPolicy: null };
    };
    if (ref === null) return unavailable("clock_model_absent", "clock_model_ref_null");

    let snapshot;
    try {
      snapshot = loadReferencedArtifact(repo, ref, { kind: "clock-model", path, identity });
    } catch (error) {
      if (error instanceof EnvironmentError && error.code === "legacy_evidence_rejected") throw error;
      return unavailable("clock_model_unreadable", error instanceof EnvironmentError ? error.code : "unreadable");
    }
    let gate;
    try {
      gate = evaluateClockGate(
        snapshot,
        {
          ...identity,
          asOf: manifest.asOf,
          tournamentStage: policy.roundPolicy.stage,
          roundDurationMinutes: policy.roundPolicy.roundDurationMinutes,
          rulesSnapshotRef: manifest.references.rules,
        },
        // The clock gate compares date-only intervals, so it receives the
        // injected instant already expressed in this environment's timezone.
        { now: localDateOf(request.now, manifest.timeZone) },
      );
    } catch (error) {
      return unavailable("clock_gate_closed", error instanceof EnvironmentError ? error.code : "invalid");
    }
    if (gate.roundTimeoutPolicy.timeoutScoring !== policy.roundPolicy.timeoutScoring) {
      return unavailable("clock_timeout_scoring_mismatch", gate.roundTimeoutPolicy.timeoutScoring);
    }
    return {
      ref: { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash },
      roundTimeoutPolicy: gate.roundTimeoutPolicy,
    };
  });

  /* -- 11. exact strata and turn-order weights --------------------- */
  const strata = runStage("plan", "matchupPolicy", () => {
    const turnOrder = policy.turnOrderWeights;
    if (Math.abs(turnOrder.play + turnOrder.draw - 1) > WEIGHT_TOLERANCE) {
      fail("manifest_invalid", "turn-order weights must sum to exactly one", {
        path: "matchupPolicy.turnOrderWeights",
        sum: turnOrder.play + turnOrder.draw,
      });
    }
    const rows = archetypes.map((archetype) => {
      const opponent = archetypeIndex.get(archetype.archetypeId);
      const sum = opponent.decks.reduce((total, representative) => total + representative.entry.weight, 0);
      if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
        fail("manifest_invalid", "within-archetype representative weights must sum to exactly one", {
          path: "opponents",
          archetypeId: archetype.archetypeId,
          sum,
        });
      }
      return {
        archetypeId: archetype.archetypeId,
        fieldWeight: archetype.share,
        representatives: opponent.decks.map((representative) => ({
          deckRef: {
            snapshotId: representative.entry.deckSnapshotId,
            contentHash: representative.entry.contentHash,
          },
          gameplayHash: representative.entry.gameplayHash,
          withinArchetypeWeight: representative.entry.weight,
        })),
      };
    });
    const fieldSum = rows.reduce((total, row) => total + row.fieldWeight, 0);
    if (Math.abs(fieldSum - 1) > WEIGHT_TOLERANCE) {
      fail("field_not_representative", "field weights must sum to exactly one; shares are never renormalized", {
        path: "references.field",
        sum: fieldSum,
      });
    }
    return rows;
  });

  const evaluationMode = degraded
    ? "diagnostic_estimate"
    : (manifest.kind === "proxy" ? "proxy" : "official");

  return freezeDeep({
    schemaVersion: 1,
    requestedEnvironment: selector.mode === "alias" ? selector.alias : manifest.manifestId,
    environmentKey: manifest.environmentKey,
    manifestRef: { manifestId: manifest.manifestId, contentHash: manifest.contentHash },
    candidateDeckRef: { ...request.candidateDeckRef },
    candidateGameplayHash,
    evaluationMode,
    strata,
    turnOrderWeights: { play: policy.turnOrderWeights.play, draw: policy.turnOrderWeights.draw },
    minimumCompletedGamesPerSeat: policy.minimumGamesPerSeat,
    matchupEvidence,
    capabilityRef: { snapshotId: capability.snapshotId, contentHash: capability.contentHash },
    clockRef: clock.ref,
    marketRefs: manifest.references.market.map((ref) => ({
      snapshotId: ref.snapshotId,
      contentHash: ref.contentHash,
    })),
    roundTimeoutPolicy: clock.roundTimeoutPolicy,
    references: {
      rules: { ...manifest.references.rules },
      cardPool: { ...manifest.references.cardPool },
      banlist: { ...manifest.references.banlist },
      constructionPolicy: { ...manifest.references.constructionPolicy },
      simulationCapability: { ...manifest.references.simulationCapability },
      field: { ...manifest.references.field },
    },
    blockers,
    warnings,
  });
}
