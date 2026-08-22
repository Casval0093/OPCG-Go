// Pure JiHuanShe tournament and market normalization (Task 7).
//
// This module performs NO acquisition (no ADB, no emulator, no network), NO publication,
// NO field aggregation, and NO strength/EV math. It transforms an exact raw CaptureResult v2
// byte buffer plus an explicit context (native environment identity, formatId, IANA
// timeZone, local-date asOf, parser version, and a parsed mapping registry) into either a
// `tournament_event` or `market` environment Snapshot, finalized through the shared
// environment/snapshot.mjs envelope.
//
// Design notes preserved here because they are load-bearing and not obvious from the code
// alone (see task-7-report.md "Fix round 1 report" and "Fix round 2 report" for the full
// derivation and the controller rulings each design point implements):
//
// - `joinToken` is read only to prove the one-to-one entrant <-> result join in memory. It
//   is replaced in every output row by a deterministic, event-local integer ordinal derived
//   from the *sorted result rank order* (plus, for entrants with no matching result row, a
//   lexicographic tie-break over the token strings themselves -- still never stored). Any
//   duplicate-token error redacts the token value itself (index/count only); non-sensitive
//   fields like rank/providerRowId keep full detail in error messages.
// - Event identity: a provider event ID is used directly when present. When absent, a
//   deterministic fallback key is derived from provider + whichever of
//   {title, startLabel, organizerLabel, locationLabel} are actually present (never derived
//   from empty/absent fields, never invented). A single event's fallback key is therefore
//   reproducible (same input -> same key) and is NOT itself an error; `event_identity_ambiguous`
//   is raised only when a BATCH contains two entries whose derived keys collide -- a single
//   normalization call has no other event to be ambiguous against.
// - Full-field promotion implements the ratified six-check ladder (spec numbering; see
//   `evaluateFieldFrame`/`isTopCutLabel` below): (1) a positive participant denominator exists
//   -- `null` (an absent or unparseable `participantCountLabel`, see I2(a)) always fails this,
//   never throws; (2) EITHER the decks tab is explicitly labelled "all entrants" OR the
//   results/entrant join is a complete bijection; (3) archetype counts (classified +
//   unresolved) equal the participant denominator (also false whenever the denominator is
//   `null`); (4) each displayed percentage -- and their sum -- reconciles with
//   `count / participant-denominator` within half a displayed unit; (5) no duplicate
//   participant/rank/provider-row/joinToken remains (a hard NORMALIZATION FAILURE, enforced
//   before this ladder ever runs, never a demotion); (6) the sample-frame label is not an
//   unrecognized one (N3) -- an ABSENT label passes this check with no warning (promotion then
//   depends entirely on check 2's join branch); the recognized all-entrants label and the
//   positively-identified Top Cut FAMILY (`淘汰赛`, any casing of "top cut" -- short-circuits to
//   `sampleFrame: "top-cut"` before this ladder even runs) both pass; any OTHER present label
//   (e.g. `分组赛`) FAILS check 6 -- as its own explicit, independent gate, not something
//   "satisfied by construction" -- so it can never reach full-field even when the join is
//   complete. Failure of checks 1-4 or 6 DEMOTES to `sampleFrame: "unknown"` with explicit
//   warnings and still publishes partial evidence; it never throws. A SEPARATE, additional
//   carve-over from the original brief (not one of the six spec checks, but still required):
//   full-field also requires zero unresolved archetype-label mappings, because Task 5
//   independently rejects any non-zero-unresolved event regardless. Event status ("completed"
//   or not) is explicitly OUT of this ladder -- it is normalized data (`data.status`) that
//   Task 5 gates on separately -- but an `event_not_completed` warning is still surfaced
//   whenever the status label is not the recognized completed one, purely as an informational,
//   non-gating fact. All ladder-adjacent facts are surfaced as *diagnostic* warnings
//   independent of whether they end up blocking promotion (e.g. a disjunction satisfied via
//   the join can still carry an "unrecognized_sample_frame_label" note) -- EXCEPT the
//   unrecognized-label warning itself, which now also gates via check 6 (N3).
// - N1: when two DIFFERENT raw archetype labels resolve to the SAME archetypeId (an alias
//   mapping), the retained `rawArchetypeLabel` on the aggregated field row is the
//   lexicographic MINIMUM of every label seen for that archetype, recomputed at every
//   occurrence -- never "whichever label happened to appear first in entrantRows." A
//   first-seen policy would make `eventEvidenceHash` depend on incidental row order for
//   identical evidence, defeating the whole point of C2's dedupe contract.
// - Percentage tolerance: convert the displayed percentage to the number of decimal digits
//   actually printed (e.g. "50%" -> 0 digits, "33.3%" -> 1 digit) and accept the row when the
//   true `count / participantDenominator * 100` is within half of one displayed unit at that
//   precision; the aggregate of displayed percentages must also agree with 100% within the sum
//   of the per-row tolerances. The denominator here is always the PARTICIPANT denominator
//   (`participantCountLabel`), never the sum of the distribution rows themselves -- comparing
//   against the distribution's own total would let a page that only shows a subset "reconcile"
//   against itself. Whether the distribution rows' own total equals the entrant row count is a
//   separate, additional internal-consistency signal (`distribution_total_entrant_mismatch`),
//   not one of the six ratified checks but kept as its own warning.
// - `eventEvidenceHash` hashes a narrow, spec-shaped projection of the snapshot: schemaVersion,
//   kind, environment, sanitized source identity, the complete normalized `data` container
//   (including the normalized `status`), coverage/warnings/missingFields, parser/mapping
//   versions, and either the provider's own observedAt or the literal string marker
//   "capture_fallback" -- never the acquisition instant itself, and never `asOf` (a capture of
//   the same event evidence on a later day must dedupe against the earlier one, which requires
//   `asOf` to be excluded from the hash entirely). That is why changing only `capturedAt` or
//   only `asOf` changes `captureHash`/`contentHash` but never `eventEvidenceHash`.

import { createHash } from "node:crypto";

import { EnvironmentError } from "../environment/errors.mjs";
import { sha256Canonical } from "../environment/hash.mjs";
import { finalizeSnapshot } from "../environment/snapshot.mjs";
import { assertEventTime } from "../environment/time.mjs";

const SUPPORTED_CAPTURE_SCHEMA_VERSION = 2;
const SUPPORTED_CAPTURE_STATUS = "ok";
const SUPPORTED_SURFACES = new Set(["tournament", "tournament-batch", "market"]);
const SUPPORTED_GAME_LABEL = "航海王简中";
const FULL_FIELD_LABEL = "全部参赛卡组";
const TOP_CUT_LABEL = "Top Cut";
// N3: the positively-identified Top Cut FAMILY -- deliberately broader than one exact ASCII
// string, since 淘汰赛 (the common SC-native term for an elimination/Top Cut bracket) and any
// casing of the English label are all the same real-world frame, not merely "unrecognized."
const TOP_CUT_LABEL_CHINESE = "淘汰赛";
const EVENT_COMPLETED_STATUS_LABEL = "已结束";
const NORMALIZED_COMPLETED_STATUS = "completed";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PARTICIPANT_COUNT_LABEL_PATTERN = /^(\d+)人$/;
const PERCENTAGE_LABEL_PATTERN = /^(\d+)(?:\.(\d+))?%$/;
const RECORD_PATTERN = /^\d+-\d+-\d+$/;
const CNY_PRICE_PATTERN = /^¥(\d+(?:,\d{3})*)(?:\.(\d+))?$/;

// Any row-level field whose *name* matches one of these is a privacy-contract violation if
// it appears anywhere on a typed row or on the top-level envelope -- distinct from a merely
// unexpected, non-sensitive extra field, which is treated as ordinary parser/UI drift instead.
const SENSITIVE_KEY_PATTERN = /(handle|nickname|displayname|realname|credential|password|secret|apikey|localpath|filepath|rawpath|transport|useragent|deviceid|ipaddress|routequery|querystring|rawrow|rawnode|domrow|cookie|session|phone|email)/i;

// ---------------------------------------------------------------------------------------
// I-1 (final fix wave): a VALUE-level privacy screen on the snapshot BODY.
//
// SENSITIVE_KEY_PATTERN above matches a KEY NAME. It cannot see a phone number, a WeChat id or a
// bearer token sitting inside the VALUE of a perfectly allowlisted field, and a whole-branch
// review probe showed exactly that: an SC store event whose organizer reads `李娜 (13900001111)`
// landed verbatim in `data/sources/**`, which is NOT gitignored and whose publication root
// defaults to this checkout. Task 9 recorded "the body rests on Tasks 7/8" as a design boundary;
// that was unsound, because Task 7 screens KEYS and Task 8 screens only MARKET CARD LABELS.
//
// Ruling: redact the offending SPAN and warn, naming the field. Never drop the field and never
// fail the capture -- an SC store event keeps its evidentiary value without the organizer's phone
// number, and a hard failure would make legitimate store events unpublishable.
//
// The shape family is Task 8's own (`looksLikeMarketCardLabel` in tools/jihuanshe_capture.mjs):
// phone-number shapes, contact-id shapes (WeChat/QQ/e-mail), Authorization/Bearer/token-like
// opaque strings, and a length cap. Deliberately NOT a personal-NAME detector: a name has no
// shape, and the ruling chose "screen values, keep the field" over "drop the field", so free text
// stays free text. What this closes is the machine-readable identifiers -- the things that make a
// leaked row re-identifiable and contactable. A venue address is likewise retained: it is a place,
// not a person, and truncating it would break the "a clean location passes untouched" contract.
const REDACTION_MARKER = "[redacted]";
const TRUNCATION_MARKER = "[truncated]";
const FREE_TEXT_MAX_LENGTH = 120;

// `personalIdentifier` marks the shapes that also disqualify a PROVIDER EVENT ID from publication
// (see providerEventIdIsPublishable). The credential rule is deliberately excluded there: an
// opaque provider id is an id, not a secret, and redacting every opaque id would be a blanket
// rather than a screen.
//
// Every global pattern is applied through String.prototype.replace, which resets `lastIndex` to 0
// for a global regex both before and after the replacement -- so these frozen module-level regexes
// carry no state between calls.
const SENSITIVE_VALUE_SPANS = Object.freeze([
  // A labelled credential swallows everything after the label, because "Authorization: Bearer X"
  // has two labels and a span-local rule would redact `Bearer` and leave `X` behind. The trigger
  // words are Task 8's SENSITIVE_LABEL_PATTERN list plus the api-key spelling; a SEPARATOR is
  // required so an ordinary word inside a title ("Token杯") is not a trigger.
  {
    code: "credential",
    personalIdentifier: false,
    pattern: /(?<![A-Za-z0-9])(authorization|bearer|password|passwd|secret|api[-_ ]?key)(\s*[:：]\s*|\s+)([\s\S]+)$/iu,
    replace: (_match, label, separator) => `${label}${separator}${REDACTION_MARKER}`,
  },
  // A mainland-China mobile number -- the exact shape Task 8's market screen rejects.
  { code: "phone_number", personalIdentifier: true, pattern: /1[3-9]\d{9}/gu, replace: () => REDACTION_MARKER },
  {
    code: "email_address",
    personalIdentifier: true,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu,
    replace: () => REDACTION_MARKER,
  },
  // A messaging handle introduced by its own label. The LABEL survives so a reader can see what
  // was removed; only the identifier itself is replaced.
  {
    code: "contact_id",
    personalIdentifier: true,
    pattern: /((?:微信号?|手机号?|电话|QQ号?|(?<![A-Za-z0-9])(?:weixin|wechat))\s*[:：]?\s*)([A-Za-z0-9._-]{4,32})(?![A-Za-z0-9._-])/giu,
    replace: (_match, label) => `${label}${REDACTION_MARKER}`,
  },
]);

// Task 8 anchors its opaque-token rule to the WHOLE label (`^...$`) and that anchoring is
// load-bearing rather than incidental: an unanchored 24-character run would redact the middle of a
// legitimate English title. A value that is nothing BUT a long opaque run is a token.
const WHOLE_VALUE_OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9+/_=-]{24,}$/u;

// I-2: the redacted stand-in for a provider event id that cannot be published. It is a FIXED
// marker with no relationship to the value it replaces -- see eventIdentityOf.
const REDACTED_PROVIDER_EVENT_ID = "redacted";
const SAFE_PROVIDER_EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function screenFreeText(value, path, warnings) {
  let screened = value;
  for (const span of SENSITIVE_VALUE_SPANS) {
    const before = screened;
    screened = screened.replace(span.pattern, span.replace);
    if (screened !== before) warnings.push(`sensitive_value_redacted:${path}:${span.code}`);
  }
  if (WHOLE_VALUE_OPAQUE_TOKEN_PATTERN.test(screened.trim())) {
    screened = REDACTION_MARKER;
    warnings.push(`sensitive_value_redacted:${path}:opaque_token`);
  }
  if (screened.length > FREE_TEXT_MAX_LENGTH) {
    screened = `${screened.slice(0, FREE_TEXT_MAX_LENGTH)}${TRUNCATION_MARKER}`;
    warnings.push(`free_text_truncated:${path}`);
  }
  return screened;
}

function personalIdentifierCodeOf(value) {
  for (const span of SENSITIVE_VALUE_SPANS) {
    if (!span.personalIdentifier) continue;
    if (value.replace(span.pattern, span.replace) !== value) return span.code;
  }
  return null;
}

function providerEventIdIsPublishable(providerEventId) {
  if (!SAFE_PROVIDER_EVENT_ID_PATTERN.test(providerEventId)) return false;
  return personalIdentifierCodeOf(providerEventId) === null;
}

const ENVELOPE_FIELDS = new Set(["schemaVersion", "source", "status", "surface", "capturedAt", "sourceRef", "data", "lifecycle"]);
const SOURCE_REF_FIELDS = new Set(["providerEventId", "sanitizedRoute"]);
// N2: the batch data container ({events}) and each per-event entry wrapper ({sourceRef, data})
// need their own allowlists, mirroring the envelope-level (I7) discipline -- otherwise a stray
// key beside `events`, or beside `sourceRef`/`data` on one entry, passes through unexamined.
// R3 (cross-task contract ruling): the batch container also optionally carries `requestWindow`
// -- the Task 8 capture window, acquisition context rather than event evidence -- allowed here
// and ONLY here; every other surface (single tournament, market) still rejects it as unknown.
const BATCH_DATA_FIELDS = new Set(["events", "requestWindow"]);
const BATCH_EVENT_FIELDS = new Set(["sourceRef", "data"]);
const REQUEST_WINDOW_FIELDS = new Set(["asOf", "windowDays"]);
const RESULTS_ROW_FIELDS = new Set(["providerRowId", "rank", "record", "score", "joinToken", "rawArchetypeLabel"]);
const ENTRANT_ROW_FIELDS = new Set(["providerRowId", "joinToken", "rawArchetypeLabel"]);
const DISTRIBUTION_ROW_FIELDS = new Set(["rawArchetypeLabel", "count", "percentageLabel"]);
const IDENTITY_REQUIRED_FIELDS = ["title", "game", "status", "startLabel", "formatLabel"];
const IDENTITY_OPTIONAL_FIELDS = ["organizerLabel", "locationLabel"];
// I2(a): participantCountLabel is validated on its own, separately from the generic
// required/optional loops below, because an absent OR unparseable value must DEMOTE
// (sampleFrame stays "unknown", warning `denominator_missing`) rather than throw -- unlike
// every other identity field, whose absence is a structural normalization failure. It still
// belongs in the allowlist so its presence is never rejected as an unsupported field.
const IDENTITY_CUSTOM_FIELDS = ["participantCountLabel"];
const IDENTITY_FIELDS = new Set([...IDENTITY_REQUIRED_FIELDS, ...IDENTITY_OPTIONAL_FIELDS, ...IDENTITY_CUSTOM_FIELDS]);
// The event-key fallback ladder (spec: "provider, event name, start time, organizer, and
// location fields that are actually present"). Order is fixed so the hashed object's shape is
// deterministic regardless of which optional fields happen to be present.
const FALLBACK_IDENTITY_FIELD_KEYS = ["title", "startLabel", "organizerLabel", "locationLabel"];

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, path, code = "normalization_failed") {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${path} must be a non-empty string`, { path });
  }
  return value;
}

function assertNoUnknownFields(value, path, allowed) {
  if (!isRecord(value)) fail("normalization_failed", `${path} must be an object`, { path });
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      fail("privacy_contract_violation", `${path}.${key} is not an allowed field`, { path, key });
    }
    fail("normalization_failed", `${path} has an unsupported field: ${key}`, { path, key });
  }
  return value;
}

function sortedWarnings(warnings) {
  return [...new Set(warnings)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// ---------------------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------------------

function assertContext(context) {
  if (!isRecord(context)) fail("normalizer_context_invalid", "context must be an object");
  if (!isRecord(context.environment)) fail("normalizer_context_invalid", "context.environment is required");
  for (const key of ["edition", "metagameRegion", "language", "formatId", "timeZone"]) {
    requiredString(context.environment[key], `context.environment.${key}`, "normalizer_context_invalid");
  }
  requiredString(context.formatId, "context.formatId", "normalizer_context_invalid");
  requiredString(context.timeZone, "context.timeZone", "normalizer_context_invalid");
  if (typeof context.asOf !== "string" || !LOCAL_DATE_PATTERN.test(context.asOf)) {
    fail("normalizer_context_invalid", "context.asOf must be a local date (YYYY-MM-DD)", { asOf: context.asOf });
  }
  requiredString(context.parserVersion, "context.parserVersion", "normalizer_context_invalid");
  if (!isRecord(context.mapping) || !isRecord(context.mapping.entries)) {
    fail("normalizer_context_invalid", "context.mapping with an entries object is required");
  }
  requiredString(context.mapping.mappingVersion, "context.mapping.mappingVersion", "normalizer_context_invalid");
  return context;
}

// ---------------------------------------------------------------------------------------
// Envelope parsing (raw bytes -> CaptureResult v2 object) and top-level validation
// ---------------------------------------------------------------------------------------

function parseCaptureResult(rawBytes) {
  let text;
  try {
    text = rawBytes.toString("utf8");
  } catch {
    fail("normalization_failed", "capture bytes could not be decoded as utf8");
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    fail("normalization_failed", "capture bytes are not valid JSON");
  }
  if (!isRecord(envelope)) fail("normalization_failed", "capture envelope must be a JSON object");
  // I7: envelope-level drift (e.g. a stray `credentials`/`deviceId` key that never should have
  // left the capture layer) must be rejected here, not silently ignored.
  assertNoUnknownFields(envelope, "envelope", ENVELOPE_FIELDS);
  if (envelope.schemaVersion !== SUPPORTED_CAPTURE_SCHEMA_VERSION) {
    fail("normalization_failed", `unsupported capture schemaVersion: ${envelope.schemaVersion}`, {
      schemaVersion: envelope.schemaVersion,
    });
  }
  if (envelope.status !== SUPPORTED_CAPTURE_STATUS) {
    fail("normalization_failed", `unsupported capture status: ${envelope.status}`, { status: envelope.status });
  }
  if (typeof envelope.surface !== "string" || !SUPPORTED_SURFACES.has(envelope.surface)) {
    fail("normalization_failed", `unsupported capture surface: ${envelope.surface}`, { surface: envelope.surface });
  }
  if (typeof envelope.capturedAt !== "string" || !RFC3339_PATTERN.test(envelope.capturedAt)) {
    fail("normalization_failed", "capturedAt must be an RFC 3339 timestamp", { capturedAt: envelope.capturedAt });
  }
  return envelope;
}

function assertSourceRef(envelope, warnings) {
  if (!isRecord(envelope.sourceRef)) fail("normalization_failed", "sourceRef is required");
  assertNoUnknownFields(envelope.sourceRef, "sourceRef", SOURCE_REF_FIELDS);
  // I-1: `sanitizedRoute` is provider-derived free text that lands in the published body, so it
  // gets the same value screen as every other free-text label -- "sanitized" upstream means query
  // values were stripped, not that a personal identifier cannot be in the path itself.
  const sanitizedRoute = screenFreeText(
    requiredString(envelope.sourceRef.sanitizedRoute, "sourceRef.sanitizedRoute"),
    "sourceRef.sanitizedRoute",
    warnings,
  );
  const rawProviderEventId = envelope.sourceRef.providerEventId;
  if (rawProviderEventId !== undefined && typeof rawProviderEventId !== "string") {
    fail("normalization_failed", "sourceRef.providerEventId must be a string", { providerEventId: rawProviderEventId });
  }
  const providerEventId = typeof rawProviderEventId === "string" && rawProviderEventId.length > 0
    ? rawProviderEventId
    : null;
  return { sanitizedRoute, providerEventId };
}

// I3: a provider event ID is used directly when present. When absent, this derives a
// deterministic fallback key from provider + whichever identity fields are actually present.
// This function NEVER throws `event_identity_ambiguous` -- a single event in isolation cannot
// be "ambiguous" against nothing; collision between two distinct batch entries is detected by
// the caller (see assertNoEventKeyCollisions), which has visibility across the whole batch.
//
// I-2 (final fix wave): a provider event id that is not publishable is redacted AT BIRTH, here,
// so the snapshot id stem, the on-disk filename and `source.sourceRef.providerEventId` all agree.
// The previous arrangement redacted only the stdout surface and wrote the artifact under its RAW
// name with the raw id in the body -- and the redacted form was `sha256(stem).slice(7,23)`, 64
// unsalted bits over a fully known 11-digit template, i.e. obfuscation rather than redaction.
//
// The form used here is IRREVERSIBLE BY CONSTRUCTION rather than by cost: the raw id is never
// hashed, encoded or stored anywhere in the output, so there is no preimage to attack. What
// remains is a fixed marker plus the snapshot's own content hash (appended by finalizeSnapshot),
// which is a hash of a body that no longer contains the id. Two captures differing ONLY in a
// redacted provider id are byte-identical, which is the test that proves the property.
//
// The event key falls back to the identity-derived key -- itself computed from ALREADY
// VALUE-SCREENED fields -- so a redacted event still dedupes stably against later captures of
// itself without the provider id entering any hash.
function eventIdentityOf(sourceRefInfo, identity, warnings) {
  if (sourceRefInfo.providerEventId !== null && providerEventIdIsPublishable(sourceRefInfo.providerEventId)) {
    return { eventKey: `jihuanshe:tournament:${sourceRefInfo.providerEventId}`, providerEventId: sourceRefInfo.providerEventId };
  }
  const redacted = sourceRefInfo.providerEventId !== null;
  if (redacted) {
    const code = personalIdentifierCodeOf(sourceRefInfo.providerEventId) ?? "unsafe_identifier";
    warnings.push(`sensitive_value_redacted:sourceRef.providerEventId:${code}`);
  }
  const present = {};
  for (const key of FALLBACK_IDENTITY_FIELD_KEYS) {
    if (typeof identity[key] === "string" && identity[key].length > 0) present[key] = identity[key];
  }
  const fallbackHash = sha256Canonical({ provider: "jihuanshe", ...present });
  return {
    eventKey: `jihuanshe:tournament:fallback:${fallbackHash}`,
    providerEventId: redacted ? REDACTED_PROVIDER_EVENT_ID : null,
  };
}

function assertNoEventKeyCollisions(snapshots) {
  const seen = new Set();
  for (const snapshot of snapshots) {
    const key = snapshot.data.eventKey;
    if (seen.has(key)) {
      fail(
        "event_identity_ambiguous",
        "two batch events share one derived event key on the identity fields actually present",
        { eventKey: key },
      );
    }
    seen.add(key);
  }
}

// ---------------------------------------------------------------------------------------
// Shared: provider-observed-time-or-capture-fallback (I6)
// ---------------------------------------------------------------------------------------

function observedAtOf(envelope) {
  // The typed `data.observedAt` field is an explicit, allowlisted, optional provider-stated
  // observation instant. Neither the tournament nor the market CaptureResult v2 contract pins
  // one anywhere else (not per-row, not per-query), so absent this field every capture falls
  // back to the valid capture instant.
  const providerObservedAt = envelope.data?.observedAt;
  if (providerObservedAt === undefined) {
    return { observedAt: envelope.capturedAt, observedAtSource: "capture_fallback" };
  }
  // N4: a PRESENT data.observedAt must be shape-validated like every other typed field in this
  // module -- silently degrading a malformed value to the capture fallback would hide a real
  // parser/UI drift defect rather than fail closed on it.
  if (typeof providerObservedAt !== "string" || !RFC3339_PATTERN.test(providerObservedAt)) {
    fail("normalization_failed", "data.observedAt must be an RFC 3339 timestamp", {
      observedAt: providerObservedAt,
    });
  }
  return { observedAt: providerObservedAt, observedAtSource: "provider" };
}

// ---------------------------------------------------------------------------------------
// Tournament: row-level validation
// ---------------------------------------------------------------------------------------

function assertResultsRow(row, index) {
  const path = `data.results.rows[${index}]`;
  assertNoUnknownFields(row, path, RESULTS_ROW_FIELDS);
  requiredString(row.providerRowId, `${path}.providerRowId`);
  if (!Number.isInteger(row.rank) || row.rank <= 0) {
    fail("normalization_failed", `${path}.rank must be a positive integer`, { path, rank: row.rank });
  }
  const record = requiredString(row.record, `${path}.record`);
  if (!RECORD_PATTERN.test(record)) fail("normalization_failed", `${path}.record is malformed`, { record });
  if (!Number.isInteger(row.score) || row.score < 0) {
    fail("normalization_failed", `${path}.score must be a non-negative integer`, { path, score: row.score });
  }
  requiredString(row.joinToken, `${path}.joinToken`);
  requiredString(row.rawArchetypeLabel, `${path}.rawArchetypeLabel`);
  return row;
}

function assertEntrantRow(row, index) {
  const path = `data.decks.entrantRows[${index}]`;
  assertNoUnknownFields(row, path, ENTRANT_ROW_FIELDS);
  requiredString(row.providerRowId, `${path}.providerRowId`);
  requiredString(row.joinToken, `${path}.joinToken`);
  requiredString(row.rawArchetypeLabel, `${path}.rawArchetypeLabel`);
  return row;
}

function assertDistributionRow(row, index) {
  const path = `data.decks.distributionRows[${index}]`;
  assertNoUnknownFields(row, path, DISTRIBUTION_ROW_FIELDS);
  requiredString(row.rawArchetypeLabel, `${path}.rawArchetypeLabel`);
  if (!Number.isInteger(row.count) || row.count <= 0) {
    fail("normalization_failed", `${path}.count must be a positive integer`, { path, count: row.count });
  }
  requiredString(row.percentageLabel, `${path}.percentageLabel`);
  return row;
}

// I4: duplicate detection over a SENSITIVE value set (e.g. joinToken) never leaks the value
// itself into the thrown message or details -- only the colliding indices. Non-sensitive
// fields (rank, providerRowId) keep full detail, since those are not participant-identifying.
function assertNoDuplicates(values, path, { code = "normalization_failed", sensitive = false } = {}) {
  const seen = new Map();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      const firstIndex = seen.get(value);
      if (sensitive) {
        fail(code, `${path} contains a duplicate value (redacted) at indices ${firstIndex} and ${index}`, {
          path,
          firstIndex,
          duplicateIndex: index,
          redacted: true,
        });
      }
      fail(code, `${path} contains a duplicate value: ${value}`, { path, value, firstIndex, duplicateIndex: index });
    }
    seen.set(value, index);
  });
}

// ---------------------------------------------------------------------------------------
// Tournament: distribution reconciliation (spec checks 3 and 4 -- NEVER throws for a value
// mismatch; only a malformed percentageLabel STRING, a parsing/shape failure, throws).
// ---------------------------------------------------------------------------------------

function evaluateDistributionReconciliation(distributionRows, participantCount, entrantRowCount) {
  const parsed = distributionRows.map((row) => {
    const match = PERCENTAGE_LABEL_PATTERN.exec(row.percentageLabel);
    if (!match) fail("normalization_failed", `percentageLabel is malformed: ${row.percentageLabel}`, { row });
    const decimals = match[2] ? match[2].length : 0;
    const displayed = Number(`${match[1]}${match[2] ? `.${match[2]}` : ""}`);
    const tolerance = 10 ** -decimals / 2;
    return { count: row.count, displayed, tolerance };
  });
  const distributionTotal = parsed.reduce((sum, row) => sum + row.count, 0);
  const distributionMatchesEntrants = distributionTotal === entrantRowCount;

  let percentagesReconciled = true;
  if (parsed.length > 0) {
    if (!(participantCount > 0)) {
      percentagesReconciled = false;
    } else {
      for (const row of parsed) {
        const actual = (row.count / participantCount) * 100;
        if (Math.abs(row.displayed - actual) > row.tolerance + 1e-9) percentagesReconciled = false;
      }
      const aggregateDisplayed = parsed.reduce((sum, row) => sum + row.displayed, 0);
      const aggregateTolerance = parsed.reduce((sum, row) => sum + row.tolerance, 0);
      if (Math.abs(aggregateDisplayed - 100) > aggregateTolerance + 1e-9) percentagesReconciled = false;
    }
  }
  return { distributionMatchesEntrants, percentagesReconciled };
}

// ---------------------------------------------------------------------------------------
// Tournament: joinToken -> deterministic event-local ordinal (never stored, never hashed)
// ---------------------------------------------------------------------------------------

function assignOrdinalsAndValidateJoin(resultsRows, entrantRows) {
  assertNoDuplicates(resultsRows.map((row) => row.joinToken), "data.results.rows[].joinToken", { sensitive: true });
  assertNoDuplicates(resultsRows.map((row) => row.rank), "data.results.rows[].rank");
  assertNoDuplicates(resultsRows.map((row) => row.providerRowId), "data.results.rows[].providerRowId");
  assertNoDuplicates(entrantRows.map((row) => row.joinToken), "data.decks.entrantRows[].joinToken", { sensitive: true });
  assertNoDuplicates(entrantRows.map((row) => row.providerRowId), "data.decks.entrantRows[].providerRowId");

  const resultsTokenSet = new Set(resultsRows.map((row) => row.joinToken));
  const entrantTokenSet = new Set(entrantRows.map((row) => row.joinToken));

  const ordinalByToken = new Map();
  [...resultsRows]
    .sort((left, right) => left.rank - right.rank)
    .forEach((row, index) => ordinalByToken.set(row.joinToken, index + 1));
  let nextOrdinal = resultsRows.length + 1;
  const unmatchedEntrantTokens = [...entrantTokenSet].filter((token) => !ordinalByToken.has(token)).sort();
  for (const token of unmatchedEntrantTokens) {
    ordinalByToken.set(token, nextOrdinal);
    nextOrdinal += 1;
  }

  const joinComplete = resultsTokenSet.size === entrantTokenSet.size
    && [...resultsTokenSet].every((token) => entrantTokenSet.has(token));

  return { ordinalByToken, joinComplete };
}

// ---------------------------------------------------------------------------------------
// Tournament: mapping resolution
// ---------------------------------------------------------------------------------------

function resolveArchetypeId(mapping, rawArchetypeLabel) {
  const entry = mapping.entries[rawArchetypeLabel];
  if (isRecord(entry) && typeof entry.archetypeId === "string" && entry.archetypeId.length > 0) {
    return entry.archetypeId;
  }
  return null;
}

// N3: the positively-identified Top Cut frame family. Deliberately broader than one exact
// ASCII string match -- 淘汰赛 and any casing of the English label are the same real-world
// frame. This is a POSITIVE identification (short-circuits to "top-cut" before the generic
// ladder even runs), distinct from an unrecognized label, which fails check 6 below instead.
function isTopCutLabel(sampleFrameLabel) {
  if (typeof sampleFrameLabel !== "string") return false;
  return sampleFrameLabel === TOP_CUT_LABEL_CHINESE || sampleFrameLabel.toLowerCase() === "top cut";
}

// ---------------------------------------------------------------------------------------
// Tournament: full-field promotion. Ratified six-check ladder (spec numbering) plus the
// original brief's separate unresolved-mapping carve-out. See the module header for the full
// derivation of every warning name below.
// ---------------------------------------------------------------------------------------

function evaluateFieldFrame({
  sampleFrameLabel, statusLabel, participantCount, resultsCount, entrantsCount, joinComplete,
  classifiedParticipants, unresolvedParticipants, unresolvedLabels,
  distributionMatchesEntrants, percentagesReconciled,
}) {
  if (isTopCutLabel(sampleFrameLabel)) {
    return { sampleFrame: "top-cut", warnings: sortedWarnings(["frame_top_cut"]) };
  }
  if (resultsCount === 0 && entrantsCount > 0) {
    return { sampleFrame: "submitted-only", warnings: sortedWarnings(["results_rows_absent"]) };
  }

  const warnings = [];
  const labelIsFullField = sampleFrameLabel === FULL_FIELD_LABEL;
  // N3 (controller ruling): an ABSENT label is not itself a problem -- there is nothing wrong
  // to report, and promotion remains possible via check 2's join branch. A label that IS
  // present but neither the recognized full-entrants string nor part of the Top Cut family
  // (already short-circuited above) is a genuine unrecognized label: it both carries the
  // warning AND fails check 6, so it can never reach full-field even with a complete join.
  const labelIsAbsent = sampleFrameLabel === undefined;
  const labelRecognizedOrAbsent = labelIsFullField || labelIsAbsent;
  if (!labelRecognizedOrAbsent) warnings.push("unrecognized_sample_frame_label");
  if (!joinComplete) warnings.push("incomplete_entrant_join");
  // Status is explicitly OUT of the ladder (it is normalized `data.status`; Task 5 gates on
  // it separately) but is still surfaced here as a purely informational, non-gating warning.
  if (statusLabel !== EVENT_COMPLETED_STATUS_LABEL) warnings.push("event_not_completed");
  if (!distributionMatchesEntrants) warnings.push("distribution_total_entrant_mismatch");

  const archetypeCountsMatchDenominator = participantCount !== null
    && (classifiedParticipants + unresolvedParticipants) === participantCount;
  if (!archetypeCountsMatchDenominator) warnings.push("archetype_count_denominator_mismatch");
  if (!percentagesReconciled) warnings.push("percentage_denominator_mismatch");
  if (unresolvedParticipants > 0 || unresolvedLabels.length > 0) warnings.push("unresolved_mapping");

  // I2(a): a missing/unparseable participant-count label demotes (this warning), it never
  // throws -- `participantCount` is `null` in that case, never a number, so `> 0` is false.
  const check1DenominatorExists = participantCount !== null && participantCount > 0;
  if (!check1DenominatorExists) warnings.push("denominator_missing");
  const check2Disjunction = labelIsFullField || joinComplete;
  const check3ArchetypeCounts = archetypeCountsMatchDenominator;
  const check4Percentages = percentagesReconciled;
  // N3: check 6 is now an explicit, independent gate -- an unrecognized (present but not
  // full-field, not Top Cut, not absent) label blocks promotion even when every other check,
  // including check 2 via a complete join, would otherwise allow it.
  const check6NotUnrecognizedLabel = labelRecognizedOrAbsent;
  // check 5 (no duplicates) is enforced earlier as a hard normalization failure, before this
  // function ever runs.
  const promotable = check1DenominatorExists && check2Disjunction && check3ArchetypeCounts
    && check4Percentages && check6NotUnrecognizedLabel && unresolvedParticipants === 0;

  if (promotable) return { sampleFrame: "full-field", warnings: sortedWarnings(warnings) };
  return { sampleFrame: "unknown", warnings: sortedWarnings(warnings) };
}

// ---------------------------------------------------------------------------------------
// Tournament: normalized status (C1) -- `已结束` -> `"completed"`; an unrecognized label keeps
// its raw text rather than being coerced, so it can never be silently misread as complete.
// ---------------------------------------------------------------------------------------

function normalizeStatus(statusLabel) {
  return statusLabel === EVENT_COMPLETED_STATUS_LABEL ? NORMALIZED_COMPLETED_STATUS : statusLabel;
}

// ---------------------------------------------------------------------------------------
// Tournament: time union (Task 5's exact union; never derived from host time)
// ---------------------------------------------------------------------------------------

function buildEventTime(startLabel, timeZone) {
  if (LOCAL_DATE_PATTERN.test(startLabel)) {
    return assertEventTime({ precision: "day", localDate: startLabel, timeZone });
  }
  if (RFC3339_PATTERN.test(startLabel)) {
    return assertEventTime({ precision: "timestamp", eventStartedAt: startLabel, timeZone });
  }
  fail("normalization_failed", `data.identity.startLabel is neither a local date nor a timestamp: ${startLabel}`);
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Tournament evidence projection (used both to compute and to independently re-derive
// eventEvidenceHash -- see buildTournamentEvidenceProjection below). Excludes `asOf` (C2) so
// re-capturing identical evidence on a later day still dedupes against the earlier snapshot;
// includes `schemaVersion`/`kind` (M3) per the spec's projection inclusion list.
// ---------------------------------------------------------------------------------------

function coverageProjection(coverage) {
  return {
    status: coverage.status,
    warnings: sortedWarnings(coverage.warnings),
    missingFields: sortedWarnings(coverage.missingFields),
  };
}

function sortFieldRows(rows) {
  return [...rows].sort((left, right) => (
    left.archetypeId < right.archetypeId ? -1
      : left.archetypeId > right.archetypeId ? 1
        : (left.rawArchetypeLabel < right.rawArchetypeLabel ? -1 : left.rawArchetypeLabel > right.rawArchetypeLabel ? 1 : 0)
  ));
}

export function buildTournamentEvidenceProjection(snapshot) {
  const { schemaVersion, kind, environment, source, coverage, data } = snapshot;
  const observedAtProjection = source.observedAtSource === "capture_fallback"
    ? { source: "capture_fallback" }
    : { source: "provider", value: source.observedAt };
  return {
    schemaVersion,
    kind,
    environment,
    sourceIdentity: {
      provider: source.provider,
      surface: source.surface,
      sanitizedRoute: source.sourceRef.sanitizedRoute,
      ...(source.sourceRef.providerEventId === null || source.sourceRef.providerEventId === undefined
        ? {}
        : { providerEventId: source.sourceRef.providerEventId }),
    },
    parserVersion: source.parserVersion,
    mappingVersion: source.mappingVersion,
    observedAt: observedAtProjection,
    coverage: coverageProjection(coverage),
    data: {
      eventKey: data.eventKey,
      status: data.status,
      time: data.time,
      identity: data.identity,
      evidenceBlocks: {
        results: {
          rows: [...data.evidenceBlocks.results.rows].sort((left, right) => (
            left.rank - right.rank
            || (left.providerRowId < right.providerRowId ? -1 : left.providerRowId > right.providerRowId ? 1 : 0)
          )),
          coverage: coverageProjection(data.evidenceBlocks.results.coverage),
        },
        field: {
          sampleFrame: data.evidenceBlocks.field.sampleFrame,
          denominator: data.evidenceBlocks.field.denominator,
          rows: sortFieldRows(data.evidenceBlocks.field.rows),
          unresolvedParticipants: data.evidenceBlocks.field.unresolvedParticipants,
          unresolvedLabels: sortedWarnings(data.evidenceBlocks.field.unresolvedLabels),
          coverage: coverageProjection(data.evidenceBlocks.field.coverage),
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------
// normalizeTournamentCapture
// ---------------------------------------------------------------------------------------

const TOURNAMENT_DATA_FIELDS = new Set(["identity", "results", "decks", "observedAt"]);

// I-1: every identity label EXCEPT `game`. `game` is pinned by exact equality to
// SUPPORTED_GAME_LABEL, so it is a constant rather than free text.
const SCREENED_IDENTITY_FIELDS = Object.freeze([
  "title", "status", "startLabel", "formatLabel", "participantCountLabel", "organizerLabel", "locationLabel",
]);

function screenIdentity(identity, warnings) {
  const screened = { game: identity.game };
  for (const key of SCREENED_IDENTITY_FIELDS) {
    if (identity[key] === undefined) continue;
    screened[key] = screenFreeText(identity[key], `data.identity.${key}`, warnings);
  }
  return screened;
}

export function normalizeTournamentCapture(envelope, context) {
  assertContext(context);
  if (!isRecord(envelope)) fail("normalization_failed", "tournament envelope must be an object");

  // I-1: every value-level redaction this call performs is recorded here and surfaced on the
  // EVENT-level coverage, so a reader of the artifact can see that something was removed and from
  // which field. It is collected before any identity value is read.
  const screenWarnings = [];
  const sourceRefInfo = assertSourceRef(envelope, screenWarnings);
  requiredString(envelope.capturedAt, "capturedAt");

  const data = envelope.data;
  if (!isRecord(data)) fail("normalization_failed", "data is required");
  assertNoUnknownFields(data, "data", TOURNAMENT_DATA_FIELDS);

  const rawIdentity = data.identity;
  assertNoUnknownFields(rawIdentity, "data.identity", IDENTITY_FIELDS);
  for (const key of IDENTITY_REQUIRED_FIELDS) requiredString(rawIdentity[key], `data.identity.${key}`);
  for (const key of IDENTITY_OPTIONAL_FIELDS) {
    if (rawIdentity[key] !== undefined) requiredString(rawIdentity[key], `data.identity.${key}`);
  }
  // I2(a): participantCountLabel's absence or an unparseable value must DEMOTE full-field
  // promotion (see parseParticipantCount below), not throw -- but a present, WRONG-TYPE value
  // (not even a string) is still a structural malformation like every other typed field.
  if (rawIdentity.participantCountLabel !== undefined && typeof rawIdentity.participantCountLabel !== "string") {
    fail("normalization_failed", "data.identity.participantCountLabel must be a string", {
      participantCountLabel: rawIdentity.participantCountLabel,
    });
  }
  if (rawIdentity.game !== SUPPORTED_GAME_LABEL) {
    fail("normalization_failed", `unsupported game: ${rawIdentity.game}`, { game: rawIdentity.game });
  }
  // I-1: from here ONLY the screened identity is read. `game` is excluded on purpose -- it is
  // pinned by exact equality to a constant one line above, so it is not free text at all.
  const identity = screenIdentity(rawIdentity, screenWarnings);

  const { eventKey, providerEventId } = eventIdentityOf(sourceRefInfo, identity, screenWarnings);

  const resultsBlock = data.results;
  if (!isRecord(resultsBlock)) fail("normalization_failed", "data.results is required");
  assertNoUnknownFields(resultsBlock, "data.results", new Set(["activeTab", "rows"]));
  if (!Array.isArray(resultsBlock.rows)) fail("normalization_failed", "data.results.rows must be an array");
  const resultsRows = resultsBlock.rows.map(assertResultsRow);

  const decksBlock = data.decks;
  if (!isRecord(decksBlock)) fail("normalization_failed", "data.decks is required");
  assertNoUnknownFields(decksBlock, "data.decks", new Set(["activeTab", "distributionRows", "entrantRows", "sampleFrameLabel"]));
  if (!Array.isArray(decksBlock.distributionRows)) fail("normalization_failed", "data.decks.distributionRows must be an array");
  if (!Array.isArray(decksBlock.entrantRows)) fail("normalization_failed", "data.decks.entrantRows must be an array");
  // N3: an ABSENT sample-frame label is not itself a problem (see evaluateFieldFrame) -- only
  // a PRESENT, non-string value is a structural malformation.
  if (decksBlock.sampleFrameLabel !== undefined && typeof decksBlock.sampleFrameLabel !== "string") {
    fail("normalization_failed", "data.decks.sampleFrameLabel must be a string", {
      sampleFrameLabel: decksBlock.sampleFrameLabel,
    });
  }
  const sampleFrameLabel = decksBlock.sampleFrameLabel;
  const distributionRows = decksBlock.distributionRows.map(assertDistributionRow);
  const entrantRows = decksBlock.entrantRows.map(assertEntrantRow);

  // I2(a): an absent or unparseable participantCountLabel is `null` here, never a throw --
  // `evaluateFieldFrame`'s check 1 (`denominator_missing`) and Task 5's own consumption both
  // fail closed on `null`, which is exactly the "no artifact" outcome except demoted instead
  // of refused, matching the ruling that only checks 1-4/6 demote and check 5 (duplicates)
  // throws.
  const participantCountMatch = typeof identity.participantCountLabel === "string"
    ? PARTICIPANT_COUNT_LABEL_PATTERN.exec(identity.participantCountLabel)
    : null;
  const participantCount = participantCountMatch ? Number(participantCountMatch[1]) : null;

  const { distributionMatchesEntrants, percentagesReconciled } = evaluateDistributionReconciliation(
    distributionRows, participantCount, entrantRows.length,
  );

  const { ordinalByToken, joinComplete } = assignOrdinalsAndValidateJoin(resultsRows, entrantRows);

  // N1: when two DIFFERENT raw labels resolve to the SAME archetypeId (an alias mapping), the
  // retained `rawArchetypeLabel` must be a function of the SET of labels seen, never of which
  // one happened to appear first in entrantRows -- otherwise eventEvidenceHash depends on
  // incidental row order for identical evidence, exactly the dedupe failure C2 exists to
  // prevent. Fix: keep the lexicographic-MINIMUM label seen for each archetypeId, computed by
  // comparing at every occurrence rather than only at first-insertion, so the result is the
  // same regardless of iteration order.
  const archetypeAgg = new Map();
  const unresolvedLabelsSet = new Set();
  let unresolvedParticipants = 0;
  for (const row of entrantRows) {
    const archetypeId = resolveArchetypeId(context.mapping, row.rawArchetypeLabel);
    if (archetypeId === null) {
      unresolvedParticipants += 1;
      unresolvedLabelsSet.add(row.rawArchetypeLabel);
      continue;
    }
    const existing = archetypeAgg.get(archetypeId);
    if (existing) {
      existing.players += 1;
      if (row.rawArchetypeLabel < existing.rawArchetypeLabel) existing.rawArchetypeLabel = row.rawArchetypeLabel;
    } else {
      archetypeAgg.set(archetypeId, { players: 1, rawArchetypeLabel: row.rawArchetypeLabel });
    }
  }
  const fieldRows = sortFieldRows(
    [...archetypeAgg.entries()].map(([archetypeId, { players, rawArchetypeLabel }]) => ({
      archetypeId, players, rawArchetypeLabel,
    })),
  );
  const classifiedParticipants = [...archetypeAgg.values()].reduce((sum, entry) => sum + entry.players, 0);
  const unresolvedLabels = sortedWarnings(unresolvedLabelsSet);

  const { sampleFrame, warnings: frameWarnings } = evaluateFieldFrame({
    sampleFrameLabel,
    statusLabel: identity.status,
    participantCount,
    resultsCount: resultsRows.length,
    entrantsCount: entrantRows.length,
    joinComplete,
    classifiedParticipants,
    unresolvedParticipants,
    unresolvedLabels,
    distributionMatchesEntrants,
    percentagesReconciled,
  });
  const coverageStatus = sampleFrame === "full-field" ? "complete" : "partial";

  const resultsOutputRows = resultsRows
    .map((row) => ({
      ordinal: ordinalByToken.get(row.joinToken),
      providerRowId: row.providerRowId,
      rank: row.rank,
      record: row.record,
      score: row.score,
      rawArchetypeLabel: row.rawArchetypeLabel,
      archetypeId: resolveArchetypeId(context.mapping, row.rawArchetypeLabel),
    }))
    .sort((left, right) => (
      left.rank - right.rank
      || (left.providerRowId < right.providerRowId ? -1 : left.providerRowId > right.providerRowId ? 1 : 0)
    ));

  const time = buildEventTime(identity.startLabel, context.timeZone);
  const { observedAt, observedAtSource } = observedAtOf(envelope);
  const normalizedStatus = normalizeStatus(identity.status);

  // I-1: a value redaction is an EVENT-level fact about the identity block, not a statement about
  // the field frame, so it joins the event coverage only. The field block keeps exactly the
  // sample-frame ladder's own warnings.
  const coverage = { status: coverageStatus, warnings: sortedWarnings([...frameWarnings, ...screenWarnings]), missingFields: [] };
  const resultsCoverage = { status: coverageStatus, warnings: [], missingFields: [] };
  const fieldCoverage = { status: coverageStatus, warnings: sortedWarnings(frameWarnings), missingFields: [] };

  const source = {
    provider: "jihuanshe",
    surface: "tournament",
    captureHash: context.captureHash,
    captureHashScope: "exact-raw-envelope-bytes",
    capturedAt: envelope.capturedAt,
    sourceRef: { providerEventId, sanitizedRoute: sourceRefInfo.sanitizedRoute },
    parserVersion: context.parserVersion,
    mappingVersion: context.mapping.mappingVersion,
    observedAt,
    observedAtSource,
  };

  const draftData = {
    eventKey,
    status: normalizedStatus,
    time,
    identity: {
      title: identity.title,
      game: identity.game,
      status: identity.status,
      startLabel: identity.startLabel,
      formatLabel: identity.formatLabel,
      // I2(a): omitted (never `undefined`-valued) when absent, since canonicalJson rejects an
      // explicit `undefined` value outright.
      ...(identity.participantCountLabel === undefined ? {} : { participantCountLabel: identity.participantCountLabel }),
      ...(identity.organizerLabel === undefined ? {} : { organizerLabel: identity.organizerLabel }),
      ...(identity.locationLabel === undefined ? {} : { locationLabel: identity.locationLabel }),
    },
    evidenceBlocks: {
      results: { rows: resultsOutputRows, coverage: resultsCoverage },
      field: {
        sampleFrame,
        denominator: { value: participantCount, source: "participantCountLabel" },
        rows: fieldRows,
        unresolvedParticipants,
        unresolvedLabels,
        coverage: fieldCoverage,
      },
    },
  };

  const projection = buildTournamentEvidenceProjection({
    schemaVersion: 1,
    kind: "tournament_event",
    environment: context.environment,
    source,
    coverage,
    data: draftData,
  });
  const eventEvidenceHash = sha256Canonical(projection);

  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "tournament_event",
      environment: context.environment,
      asOf: context.asOf,
      source,
      coverage,
      data: { ...draftData, eventEvidenceHash },
    },
    `jihuanshe-tournament-${providerEventId ?? "fallback"}`,
  );
}

// ---------------------------------------------------------------------------------------
// normalizeMarketCapture
// ---------------------------------------------------------------------------------------

const MARKET_ROW_FIELDS = new Set([
  "providerRowId", "rawCardLabel", "printingId", "languageLabel", "conditionLabel",
  "gradeLabel", "observedPriceLabel", "previousPriceLabel",
]);
const MARKET_DATA_FIELDS = new Set(["identity", "query", "rows", "visibleRowCount", "paginationComplete", "observedAt"]);

function parseCnyPrice(label, path) {
  const match = CNY_PRICE_PATTERN.exec(label);
  if (!match) fail("normalization_failed", `${path} must be a CNY-formatted price: ${label}`, { path, label });
  const digits = `${match[1].replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`;
  return Number(digits);
}

function assertMarketRow(row, index) {
  const path = `data.rows[${index}]`;
  assertNoUnknownFields(row, path, MARKET_ROW_FIELDS);
  requiredString(row.providerRowId, `${path}.providerRowId`);
  requiredString(row.rawCardLabel, `${path}.rawCardLabel`);
  requiredString(row.observedPriceLabel, `${path}.observedPriceLabel`);
  for (const optional of ["printingId", "languageLabel", "conditionLabel", "gradeLabel", "previousPriceLabel"]) {
    if (row[optional] !== undefined) requiredString(row[optional], `${path}.${optional}`);
  }
  return row;
}

export function normalizeMarketCapture(envelope, context) {
  assertContext(context);
  if (!isRecord(envelope)) fail("normalization_failed", "market envelope must be an object");

  // I-1: the market surface gets the SAME independent value screen. Task 8 screens card labels at
  // capture time, but this module is a pure function over arbitrary bytes and cannot inherit an
  // upstream guarantee -- which is precisely the reasoning the review found unsound for the
  // tournament body.
  const screenWarnings = [];
  const sourceRefInfo = assertSourceRef(envelope, screenWarnings);
  requiredString(envelope.capturedAt, "capturedAt");

  const data = envelope.data;
  if (!isRecord(data)) fail("normalization_failed", "data is required");
  assertNoUnknownFields(data, "data", MARKET_DATA_FIELDS);

  const identity = data.identity;
  assertNoUnknownFields(identity, "data.identity", new Set(["game"]));
  requiredString(identity.game, "data.identity.game");
  if (identity.game !== SUPPORTED_GAME_LABEL) {
    fail("normalization_failed", `unsupported game: ${identity.game}`, { game: identity.game });
  }

  const rawQuery = data.query;
  if (!isRecord(rawQuery)) fail("normalization_failed", "data.query is required");
  assertNoUnknownFields(rawQuery, "data.query", new Set(["searchLabel", "filterLabels", "sortLabel"]));
  requiredString(rawQuery.searchLabel, "data.query.searchLabel");
  if (!Array.isArray(rawQuery.filterLabels) || rawQuery.filterLabels.some((label) => typeof label !== "string")) {
    fail("normalization_failed", "data.query.filterLabels must be an array of strings");
  }
  requiredString(rawQuery.sortLabel, "data.query.sortLabel");
  const query = {
    searchLabel: screenFreeText(rawQuery.searchLabel, "data.query.searchLabel", screenWarnings),
    filterLabels: rawQuery.filterLabels.map(
      (label, index) => screenFreeText(label, `data.query.filterLabels[${index}]`, screenWarnings),
    ),
    sortLabel: screenFreeText(rawQuery.sortLabel, "data.query.sortLabel", screenWarnings),
  };

  if (!Array.isArray(data.rows)) fail("normalization_failed", "data.rows must be an array");
  const rawRows = data.rows.map(assertMarketRow);
  assertNoDuplicates(rawRows.map((row) => row.providerRowId), "data.rows[].providerRowId");

  if (typeof data.visibleRowCount !== "number" || data.visibleRowCount !== rawRows.length) {
    fail("normalization_failed", "data.visibleRowCount must equal data.rows.length", {
      visibleRowCount: data.visibleRowCount,
      rows: rawRows.length,
    });
  }

  const rows = rawRows.map((row, index) => {
    // I-1: screened BEFORE the mapping lookup, so the stored label and the key it was resolved
    // under are always the same string.
    const rawCardLabel = screenFreeText(row.rawCardLabel, `data.rows[${index}].rawCardLabel`, screenWarnings);
    const mappingEntry = context.mapping.entries[rawCardLabel];
    let gameplayId = null;
    if (isRecord(mappingEntry) && typeof mappingEntry.gameplayId === "string" && mappingEntry.gameplayId.length > 0) {
      if (mappingEntry.printingId === undefined || mappingEntry.printingId === row.printingId) {
        gameplayId = mappingEntry.gameplayId;
      }
    }
    return {
      providerRowId: row.providerRowId,
      rawCardLabel,
      printingId: row.printingId ?? null,
      languageLabel: row.languageLabel ?? null,
      conditionLabel: row.conditionLabel ?? null,
      gradeLabel: row.gradeLabel ?? null,
      gameplayId,
      currency: "CNY",
      observedPrice: parseCnyPrice(row.observedPriceLabel, `data.rows[?].observedPriceLabel`),
      previousPrice: row.previousPriceLabel === undefined
        ? null
        : parseCnyPrice(row.previousPriceLabel, `data.rows[?].previousPriceLabel`),
    };
  });

  const { observedAt, observedAtSource } = observedAtOf(envelope);

  const source = {
    provider: "jihuanshe",
    surface: "market",
    captureHash: context.captureHash,
    captureHashScope: "exact-raw-envelope-bytes",
    capturedAt: envelope.capturedAt,
    sourceRef: { sanitizedRoute: sourceRefInfo.sanitizedRoute },
    parserVersion: context.parserVersion,
    mappingVersion: context.mapping.mappingVersion,
    observedAt,
    observedAtSource,
  };

  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "market",
      environment: context.environment,
      asOf: context.asOf,
      source,
      coverage: { status: "complete", warnings: sortedWarnings(screenWarnings), missingFields: [] },
      data: {
        identity: { game: identity.game },
        query: {
          searchLabel: query.searchLabel,
          filterLabels: [...query.filterLabels],
          sortLabel: query.sortLabel,
        },
        scope: "visible-viewport",
        visibleRowCount: data.visibleRowCount,
        paginationComplete: false,
        rows,
      },
    },
    `jihuanshe-market-${context.asOf}`,
  );
}

// R3: the batch data container's optional requestWindow -- { asOf, windowDays } exactly, the
// Task 8 capture window. This is acquisition context only: it is validated here, at the batch
// envelope level, and is never threaded into any per-event normalizeTournamentCapture call
// (each event only ever receives { ...envelope, data: event.data }, which replaces `data`
// wholesale rather than merging it, so requestWindow structurally cannot leak into per-event
// output or its evidence hash).
function assertRequestWindow(requestWindow) {
  if (requestWindow === undefined) return;
  if (!isRecord(requestWindow)) {
    fail("normalization_failed", "data.requestWindow must be an object", { requestWindow });
  }
  assertNoUnknownFields(requestWindow, "data.requestWindow", REQUEST_WINDOW_FIELDS);
  if (typeof requestWindow.asOf !== "string" || !LOCAL_DATE_PATTERN.test(requestWindow.asOf)) {
    fail("normalization_failed", "data.requestWindow.asOf must be a local date (YYYY-MM-DD)", {
      asOf: requestWindow.asOf,
    });
  }
  if (!Number.isSafeInteger(requestWindow.windowDays) || requestWindow.windowDays <= 0) {
    fail("normalization_failed", "data.requestWindow.windowDays must be a positive safe integer", {
      windowDays: requestWindow.windowDays,
    });
  }
}

// ---------------------------------------------------------------------------------------
// normalizeJiHuanSheCapture: entry point over exact raw bytes
// ---------------------------------------------------------------------------------------

export function normalizeJiHuanSheCapture(rawBytes, context) {
  if (!Buffer.isBuffer(rawBytes)) {
    fail("capture_bytes_required", "Normalizer requires the exact raw Buffer");
  }
  assertContext(context);
  const captureHash = `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`;
  const envelope = parseCaptureResult(rawBytes);
  if (envelope.surface === "tournament-batch") {
    if (!isRecord(envelope.data)) fail("normalization_failed", "tournament-batch data is required");
    // N2: allowlist the batch container itself -- a stray key beside `events` (e.g. a
    // `deviceId` the capture layer should never have surfaced) must be rejected here, not
    // silently ignored.
    assertNoUnknownFields(envelope.data, "data", BATCH_DATA_FIELDS);
    // R3: shape-validate the optional requestWindow; never read past this point (deliberately
    // not destructured into anything passed to normalizeTournamentCapture below).
    assertRequestWindow(envelope.data.requestWindow);
    if (!Array.isArray(envelope.data.events) || envelope.data.events.length === 0) {
      fail("normalization_failed", "tournament-batch requires a non-empty data.events array");
    }
    // C3: each batch entry is a per-event typed wrapper `{ sourceRef, data }`. Merging with
    // the outer envelope's OWN sourceRef (as an earlier version of this module did) would
    // collapse every event in the batch onto one provider identity; this instead retains each
    // event's own sourceRef, so two different events always keep distinct identities.
    const snapshots = envelope.data.events.map((event, index) => {
      const path = `data.events[${index}]`;
      if (!isRecord(event)) fail("normalization_failed", `${path} must be an object`);
      // N2: allowlist each entry wrapper -- a stray key beside `sourceRef`/`data` on one entry
      // (e.g. a `credentials` field) must be rejected here too.
      assertNoUnknownFields(event, path, BATCH_EVENT_FIELDS);
      if (!isRecord(event.sourceRef) || !isRecord(event.data)) {
        fail("normalization_failed", `${path} must be { sourceRef, data }`);
      }
      return normalizeTournamentCapture(
        { ...envelope, surface: "tournament", sourceRef: event.sourceRef, data: event.data },
        { ...context, captureHash },
      );
    });
    assertNoEventKeyCollisions(snapshots);
    return snapshots;
  }
  if (envelope.surface === "tournament") {
    return [normalizeTournamentCapture(envelope, { ...context, captureHash })];
  }
  return [normalizeMarketCapture(envelope, { ...context, captureHash })];
}
