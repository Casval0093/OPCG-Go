import { EnvironmentError } from "./errors.mjs";
import { hashProjection } from "./hash.mjs";

const SUPPORTED_SCHEMA_VERSION = 1;
const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/;
const ID_STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DAY_PRECISION_KEYS = new Set(["releasedAt", "eventStartedAt", "eventEndedAt", "observedAt"]);
const NATIVE_ENVIRONMENT_TUPLES = [
  { edition: "SC", metagameRegion: "CN", language: "zh-Hans" },
  { edition: "EN", metagameRegion: "GLOBAL_EN", language: "en" },
];

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, path) {
  if (!isRecord(value)) fail("snapshot_missing_field", `${path} must be an object`, { path });
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    fail("snapshot_missing_field", `${path} must be a non-empty string`, { path });
  }
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidLocalDate(value) {
  const match = typeof value === "string" ? LOCAL_DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function assertLocalDate(value, path) {
  if (!isValidLocalDate(value)) {
    fail("snapshot_date_invalid", `${path} must be an RFC 3339 local date`, { path, value });
  }
}

function isValidTimestamp(value) {
  const match = typeof value === "string" ? RFC3339_PATTERN.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offset !== "Z" && offset !== "z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function assertTimestamp(value, path) {
  if (!isValidTimestamp(value)) {
    fail("snapshot_timestamp_invalid", `${path} must be an RFC 3339 timestamp`, { path, value });
  }
}

function assertDayPrecision(value, path) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 3
    || !Object.hasOwn(value, "localDate")
    || !Object.hasOwn(value, "precision")
    || !Object.hasOwn(value, "timeZone")
    || value.precision !== "day"
  ) {
    fail("snapshot_timestamp_invalid", `${path} must be a day-precision local date`, { path, value });
  }
  assertLocalDate(value.localDate, `${path}.localDate`);
  assertNonEmptyString(value.timeZone, `${path}.timeZone`);
}

function assertHash(value, path) {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail("snapshot_hash_invalid", `${path} must be a full sha256 hash`, { path, value });
  }
}

function validateNestedFields(value, path = "snapshot", active = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (active.has(value)) fail("snapshot_invalid", "snapshot contains a cycle", { path });
  active.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => validateNestedFields(entry, `${path}[${index}]`, active));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (/(?:hash|Hash)$/.test(key)) assertHash(entry, childPath);
      if (key === "localDate" || key === "asOf") assertLocalDate(entry, childPath);
      if (key.endsWith("At")) {
        if (isRecord(entry) && entry.precision === "day" && DAY_PRECISION_KEYS.has(key)) {
          assertDayPrecision(entry, childPath);
        }
        else assertTimestamp(entry, childPath);
      }
      validateNestedFields(entry, childPath, active);
    }
  } finally {
    active.delete(value);
  }
}

function assertEnvelopeIdentity(snapshot, { draft = false } = {}) {
  if (!isRecord(snapshot)) fail("snapshot_missing_field", "snapshot must be an object", { path: "snapshot" });
  if (snapshot.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      "snapshot_schema_unsupported",
      `unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`,
      { schemaVersion: snapshot.schemaVersion },
    );
  }
  if (draft && (Object.hasOwn(snapshot, "snapshotId") || Object.hasOwn(snapshot, "contentHash"))) {
    fail("snapshot_draft_invalid", "snapshot drafts must not contain snapshotId or contentHash");
  }
  assertNonEmptyString(snapshot.kind, "kind");
  assertRecord(snapshot.environment, "environment");
  if (snapshot.environment.scope === "edition-neutral") {
    if (
      snapshot.kind !== "deck"
      || Object.keys(snapshot.environment).length !== 1
      || !Object.hasOwn(snapshot.environment, "scope")
    ) {
      fail(
        "environment_identity_mismatch",
        "edition-neutral identity is reserved for deck snapshots",
        { kind: snapshot.kind, environment: snapshot.environment },
      );
    }
  } else {
    if (snapshot.kind === "deck") {
      fail(
        "environment_identity_mismatch",
        "deck snapshots must use edition-neutral identity",
        { reason: "deck_must_be_edition_neutral", kind: snapshot.kind },
      );
    }
    for (const key of ["edition", "metagameRegion", "language", "formatId", "timeZone"]) {
      assertNonEmptyString(snapshot.environment[key], `environment.${key}`);
    }
    if (!NATIVE_ENVIRONMENT_TUPLES.some((tuple) => (
      snapshot.environment.edition === tuple.edition
      && snapshot.environment.metagameRegion === tuple.metagameRegion
      && snapshot.environment.language === tuple.language
    ))) {
      fail(
        "environment_identity_mismatch",
        "snapshot environment is not a supported native v1 identity",
        {
          reason: "native_identity_unsupported",
          edition: snapshot.environment.edition,
          metagameRegion: snapshot.environment.metagameRegion,
          language: snapshot.environment.language,
        },
      );
    }
  }
  assertLocalDate(snapshot.asOf, "asOf");
  assertRecord(snapshot.source, "source");
  assertRecord(snapshot.coverage, "coverage");
  assertRecord(snapshot.data, "data");
  validateNestedFields(snapshot);
}

function normalizeIdStem(idStem) {
  if (typeof idStem !== "string") fail("snapshot_id_stem_invalid", "idStem must be a string");
  const normalized = idStem.normalize("NFC").trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!ID_STEM_PATTERN.test(normalized)) {
    fail("snapshot_id_stem_invalid", "idStem does not contain a safe identifier", { idStem });
  }
  return normalized;
}

function cloneSnapshot(value) {
  try {
    return structuredClone(value);
  } catch (error) {
    fail("snapshot_invalid", "snapshot is not cloneable JSON data", {
      cause: error?.code ?? error?.message,
    });
  }
}

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

export function finalizeSnapshot(draft, idStem) {
  assertEnvelopeIdentity(draft, { draft: true });
  const snapshot = cloneSnapshot(draft);
  let contentHash;
  try {
    contentHash = hashProjection(snapshot, []);
  } catch (error) {
    fail("snapshot_invalid", "snapshot contains unsupported canonical data", {
      cause: error?.code ?? error?.message,
    });
  }
  const snapshotId = `${normalizeIdStem(idStem)}-${contentHash.slice(7, 23)}`;
  return freezeDeep({ ...snapshot, snapshotId, contentHash });
}

export function verifySnapshot(snapshot) {
  assertEnvelopeIdentity(snapshot);
  if (typeof snapshot.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(snapshot.snapshotId)) {
    fail("snapshot_id_invalid", "snapshotId must contain a 16-hex hash suffix", {
      snapshotId: snapshot.snapshotId,
    });
  }
  assertHash(snapshot.contentHash, "contentHash");

  let expectedHash;
  try {
    expectedHash = hashProjection(snapshot, ["snapshotId", "contentHash"]);
  } catch (error) {
    fail("snapshot_invalid", "snapshot contains unsupported canonical data", {
      cause: error?.code ?? error?.message,
    });
  }
  if (snapshot.contentHash !== expectedHash) {
    fail("snapshot_hash_mismatch", "snapshot content hash does not match its immutable content", {
      expectedHash,
      contentHash: snapshot.contentHash,
    });
  }
  if (!snapshot.snapshotId.endsWith(snapshot.contentHash.slice(7, 23))) {
    fail("snapshot_id_hash_mismatch", "snapshotId hash suffix does not match contentHash", {
      snapshotId: snapshot.snapshotId,
      contentHash: snapshot.contentHash,
    });
  }
  return snapshot;
}

export function snapshotRef(snapshot) {
  verifySnapshot(snapshot);
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
  });
}

export { FULL_HASH_PATTERN };
