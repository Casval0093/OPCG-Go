import { EnvironmentError } from "./errors.mjs";
import { sha256Canonical } from "./hash.mjs";
import { finalizeSnapshot } from "./snapshot.mjs";

export const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const NATIVE_ENVIRONMENTS = Object.freeze([
  Object.freeze({ edition: "SC", metagameRegion: "CN", language: "zh-Hans" }),
  Object.freeze({ edition: "EN", metagameRegion: "GLOBAL_EN", language: "en" }),
]);

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, path, code = "rules_invalid") {
  if (typeof value !== "string" || value.length === 0) fail(code, `${path} must be a non-empty string`, { path, value });
  return value;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateFromTimestamp(value) {
  if (
    isRecord(value)
    && value.precision === "day"
    && typeof value.localDate === "string"
    && isValidDate(value.localDate)
  ) return value.localDate;
  if (typeof value !== "string") return null;
  if (isValidDate(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return null;
}

function assertDate(value, path, { nullable = false } = {}) {
  if (value === null && nullable) return value;
  if (!isValidDate(value)) fail("rules_invalid", `${path} must be a valid local date`, { path, value });
  return value;
}

function assertFullHash(value, path) {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail("rules_invalid", `${path} must be a full sha256 hash`, { path, value });
  }
  return value;
}

function inputEnvironment(input) {
  const environment = isRecord(input.environment) ? input.environment : {};
  const result = {
    edition: environment.edition ?? input.edition,
    metagameRegion: environment.metagameRegion ?? input.metagameRegion,
    language: environment.language ?? input.language,
    formatId: environment.formatId ?? input.formatId,
    timeZone: environment.timeZone ?? input.timeZone,
  };
  for (const [key, value] of Object.entries(result)) requiredString(value, `environment.${key}`, "environment_identity_mismatch");
  return result;
}

export function assertNativeEnvironment(environment) {
  if (!isRecord(environment)) fail("environment_identity_mismatch", "environment must be an object");
  const match = NATIVE_ENVIRONMENTS.some((native) => (
    environment.edition === native.edition
    && environment.metagameRegion === native.metagameRegion
    && environment.language === native.language
  ));
  if (!match) {
    fail("environment_identity_mismatch", "environment identity is not a supported native v1 combination", {
      reason: "native_identity_unsupported",
      edition: environment.edition,
      metagameRegion: environment.metagameRegion,
      language: environment.language,
    });
  }
  for (const key of ["formatId", "timeZone"]) requiredString(environment[key], `environment.${key}`, "environment_identity_mismatch");
  return environment;
}

function inputAsOf(input, intervalStart = null) {
  const asOf = input.asOf ?? input.context?.asOf ?? intervalStart;
  return assertDate(asOf, "asOf");
}

function inputSource(input) {
  const source = input.source ?? input.context?.source;
  if (!isRecord(source)) fail("rules_invalid", "source must be an object", { path: "source" });
  return source;
}

function inputCoverage(input) {
  return input.coverage ?? {
    status: "complete",
    warnings: [],
    missingFields: [],
  };
}

function intervalInput(input) {
  const interval = isRecord(input.effectiveInterval) ? input.effectiveInterval : {};
  const effectiveFrom = input.effectiveFrom ?? interval.from ?? interval.effectiveFrom ?? null;
  const effectiveUntil = input.effectiveUntil ?? interval.until ?? interval.effectiveUntil ?? null;
  if (effectiveFrom === null) fail("rules_invalid", "effectiveFrom is required", { path: "effectiveFrom" });
  assertDate(effectiveFrom, "effectiveFrom");
  if (effectiveUntil !== null) assertDate(effectiveUntil, "effectiveUntil", { nullable: true });
  if (effectiveFrom !== null && effectiveUntil !== null && effectiveFrom > effectiveUntil) {
    fail("rules_invalid", "effective interval is reversed", { effectiveFrom, effectiveUntil });
  }
  return { effectiveFrom, effectiveUntil };
}

function snapshotBase(kind, input, environment, asOf, data, idStem) {
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind,
      environment,
      asOf,
      source: inputSource(input),
      coverage: inputCoverage(input),
      data,
    },
    idStem,
  );
}

function documentReferences(input) {
  const refs = input.documentRefs ?? input.documentVersionRefs;
  if (!Array.isArray(refs) || refs.length === 0) fail("rules_invalid", "documentRefs must be a non-empty array");
  const normalized = refs.map((ref, index) => {
    if (!isRecord(ref)) fail("rules_invalid", "document reference must be an object", { index });
    const documentId = requiredString(ref.documentId ?? ref.id, `documentRefs[${index}].documentId`);
    const version = requiredString(ref.version ?? ref.versionId, `documentRefs[${index}].version`);
    const sourceHash = assertFullHash(ref.sourceHash ?? ref.referenceHash, `documentRefs[${index}].sourceHash`);
    return { ...ref, documentId, version, sourceHash };
  });
  return normalized.sort((left, right) => {
    const a = `${left.documentId}\u0000${left.version}\u0000${left.sourceHash}`;
    const b = `${right.documentId}\u0000${right.version}\u0000${right.sourceHash}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function sourceHashes(input, documentRefs) {
  const hashes = input.sourceHashes ?? documentRefs.map((ref) => ref.sourceHash);
  if (!Array.isArray(hashes) || hashes.length === 0) fail("rules_invalid", "sourceHashes must be a non-empty array");
  return [...new Set(hashes.map((hash, index) => assertFullHash(hash, `sourceHashes[${index}]`)))].sort();
}

export function buildRulesSnapshot(input) {
  if (!isRecord(input)) fail("rules_invalid", "rules input must be an object");
  const environment = assertNativeEnvironment(inputEnvironment(input));
  const interval = intervalInput(input);
  const asOf = inputAsOf(input, interval.effectiveFrom);
  const documentRefs = documentReferences(input);
  const hashes = sourceHashes(input, documentRefs);
  const authority = input.authority ?? input.authorityRef;
  if (!isRecord(authority) && typeof authority !== "string") fail("rules_invalid", "authority must be an object or string");
  const formatId = requiredString(input.formatId ?? environment.formatId, "formatId");
  if (formatId !== environment.formatId) fail("environment_identity_mismatch", "rules format differs from environment", { reason: "format_mismatch" });
  const identityProjection = {
    schemaVersion: 1,
    edition: environment.edition,
    formatId,
    authority,
    documentRefs,
    effectiveFrom: interval.effectiveFrom,
    effectiveUntil: interval.effectiveUntil,
    sourceHashes: hashes,
  };
  const rulesIdentityHash = sha256Canonical(identityProjection);
  return snapshotBase(
    "rules",
    input,
    environment,
    asOf,
    {
      formatId,
      authority,
      documentRefs,
      effectiveFrom: interval.effectiveFrom,
      effectiveUntil: interval.effectiveUntil,
      sourceHashes: hashes,
      rulesIdentityHash,
    },
    input.idStem ?? `${environment.edition.toLowerCase()}-rules-${formatId}`,
  );
}

function isValidTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  const offset = match[8];
  if (offset !== "Z") {
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isExactDayPrecision(value) {
  return isRecord(value)
    && Object.keys(value).length === 3
    && Object.hasOwn(value, "localDate")
    && Object.hasOwn(value, "precision")
    && Object.hasOwn(value, "timeZone")
    && value.precision === "day";
}

function normalizeReleasedAt(value, path, timeZone) {
  if (isValidDate(value)) {
    return { localDate: value, precision: "day", timeZone };
  }
  if (isExactDayPrecision(value)) {
    if (!isValidDate(value.localDate) || value.timeZone !== timeZone) {
      fail("rules_invalid", `${path} day-precision timezone does not match its environment`, {
        path,
        timeZone,
        value,
      });
    }
    return {
      localDate: value.localDate,
      precision: "day",
      timeZone: value.timeZone,
    };
  }
  if (isValidTimestamp(value)) return value;
  fail("rules_invalid", `${path} must be a date or RFC3339 timestamp`, { path, value });
}

function cardRows(input, timeZone) {
  if (!Array.isArray(input.cards)) fail("rules_invalid", "cards must be an array");
  const seen = new Set();
  const rows = input.cards.map((card, index) => {
    if (!isRecord(card)) fail("rules_invalid", "card-pool rows must be objects", { index });
    const gameplayId = requiredString(card.gameplayId ?? card.id, `cards[${index}].gameplayId`, "card_pool_unverified");
    if (seen.has(gameplayId)) fail("rules_invalid", "card-pool rows must not duplicate gameplay IDs", { gameplayId });
    seen.add(gameplayId);
    const rulesIdentityHash = assertFullHash(card.rulesIdentityHash, `cards[${index}].rulesIdentityHash`);
    const releasedAt = normalizeReleasedAt(card.releasedAt, `cards[${index}].releasedAt`, timeZone);
    const legalFrom = assertDate(card.legalFrom, `cards[${index}].legalFrom`);
    const legalUntil = card.legalUntil ?? null;
    if (legalUntil !== null) assertDate(legalUntil, `cards[${index}].legalUntil`, { nullable: true });
    if (legalUntil !== null && legalFrom > legalUntil) fail("rules_invalid", "card legal interval is reversed", { gameplayId });
    if (card.releaseEvidenceRef === undefined || card.releaseEvidenceRef === null) {
      fail("rules_invalid", "releaseEvidenceRef is required", { gameplayId });
    }
    return {
      ...card,
      gameplayId,
      rulesIdentityHash,
      releasedAt,
      legalFrom,
      legalUntil,
    };
  });
  return rows.sort((left, right) => left.gameplayId < right.gameplayId ? -1 : left.gameplayId > right.gameplayId ? 1 : 0);
}

export function buildCardPoolSnapshot(input) {
  if (!isRecord(input)) fail("rules_invalid", "card-pool input must be an object");
  const environment = assertNativeEnvironment(inputEnvironment(input));
  const interval = intervalInput(input);
  const asOf = inputAsOf(input, interval.effectiveFrom);
  const formatId = requiredString(input.formatId ?? environment.formatId, "formatId");
  if (formatId !== environment.formatId) fail("environment_identity_mismatch", "card-pool format differs from environment", { reason: "format_mismatch" });
  return snapshotBase(
    "card_pool",
    input,
    environment,
    asOf,
    {
      formatId,
      effectiveFrom: interval.effectiveFrom,
      effectiveUntil: interval.effectiveUntil,
      cards: cardRows(input, environment.timeZone),
    },
    input.idStem ?? `${environment.edition.toLowerCase()}-card-pool-${formatId}`,
  );
}

function banlistRows(input) {
  const entries = input.entries ?? input.cards;
  if (!Array.isArray(entries)) fail("rules_invalid", "entries must be an array");
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!isRecord(entry)) fail("rules_invalid", "banlist rows must be objects", { index });
    const gameplayId = requiredString(entry.gameplayId ?? entry.id, `entries[${index}].gameplayId`);
    if (seen.has(gameplayId)) fail("rules_invalid", "banlist rows must not duplicate gameplay IDs", { gameplayId });
    seen.add(gameplayId);
    const status = entry.status;
    if (status !== "banned" && status !== "restricted") fail("rules_invalid", "banlist status is invalid", { gameplayId, status });
    const maxCopies = entry.maxCopies;
    if (!Number.isSafeInteger(maxCopies) || maxCopies < 0 || maxCopies > 4) fail("rules_invalid", "banlist maxCopies is invalid", { gameplayId, maxCopies });
    const effectiveFrom = assertDate(entry.effectiveFrom, `entries[${index}].effectiveFrom`);
    const effectiveUntil = entry.effectiveUntil ?? null;
    if (effectiveUntil !== null) assertDate(effectiveUntil, `entries[${index}].effectiveUntil`, { nullable: true });
    if (effectiveUntil !== null && effectiveFrom > effectiveUntil) fail("rules_invalid", "banlist interval is reversed", { gameplayId });
    if (entry.authorityRef === undefined || entry.authorityRef === null) fail("rules_invalid", "authorityRef is required", { gameplayId });
    return { ...entry, gameplayId, status, maxCopies, effectiveFrom, effectiveUntil };
  }).sort((left, right) => left.gameplayId < right.gameplayId ? -1 : left.gameplayId > right.gameplayId ? 1 : 0);
}

export function buildBanlistSnapshot(input) {
  if (!isRecord(input)) fail("rules_invalid", "banlist input must be an object");
  const environment = assertNativeEnvironment(inputEnvironment(input));
  const interval = intervalInput(input);
  const asOf = inputAsOf(input, interval.effectiveFrom);
  const formatId = requiredString(input.formatId ?? environment.formatId, "formatId");
  if (formatId !== environment.formatId) fail("environment_identity_mismatch", "banlist format differs from environment", { reason: "format_mismatch" });
  return snapshotBase(
    "banlist",
    input,
    environment,
    asOf,
    {
      formatId,
      effectiveFrom: interval.effectiveFrom,
      effectiveUntil: interval.effectiveUntil,
      entries: banlistRows(input),
    },
    input.idStem ?? `${environment.edition.toLowerCase()}-banlist-${formatId}`,
  );
}

export function buildConstructionSnapshot(input) {
  if (!isRecord(input)) fail("rules_invalid", "construction input must be an object");
  const environment = assertNativeEnvironment(inputEnvironment(input));
  const interval = intervalInput(input);
  const asOf = inputAsOf(input, interval.effectiveFrom);
  const formatId = requiredString(input.formatId ?? environment.formatId, "formatId");
  if (formatId !== environment.formatId) fail("environment_identity_mismatch", "construction format differs from environment", { reason: "format_mismatch" });
  const mainDeckSize = input.mainDeckSize;
  const leaderCount = input.leaderCount;
  const defaultMaxCopies = input.defaultMaxCopies;
  if (mainDeckSize !== 50) fail("rules_invalid", "standard construction mainDeckSize must be 50", { mainDeckSize });
  if (leaderCount !== 1) fail("rules_invalid", "standard construction leaderCount must be 1", { leaderCount });
  if (defaultMaxCopies !== 4) fail("rules_invalid", "standard construction defaultMaxCopies must be 4", { defaultMaxCopies });
  if (!Array.isArray(input.allowedLeaderColors) || input.allowedLeaderColors.length === 0) fail("rules_invalid", "allowedLeaderColors must be a non-empty array");
  const allowedLeaderColors = [...new Set(input.allowedLeaderColors.map((color, index) => requiredString(color, `allowedLeaderColors[${index}]`)))].sort();
  return snapshotBase(
    "construction",
    input,
    environment,
    asOf,
    {
      formatId,
      effectiveFrom: interval.effectiveFrom,
      effectiveUntil: interval.effectiveUntil,
      mainDeckSize,
      leaderCount,
      defaultMaxCopies,
      allowedLeaderColors,
    },
    input.idStem ?? `${environment.edition.toLowerCase()}-construction-${formatId}`,
  );
}

export function dateOnly(value) {
  const date = dateFromTimestamp(value);
  if (!date || !isValidDate(date)) return null;
  return date;
}

export function dateInInterval(value, from, until) {
  const date = dateOnly(value);
  if (!date) return false;
  const lower = from === null || from === undefined ? true : date >= from;
  const upper = until === null || until === undefined ? true : date <= until;
  return lower && upper;
}
