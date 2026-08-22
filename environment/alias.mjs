// Environment selectors, alias records, and the repository's INTERNAL
// filesystem mapping.
//
// Controller ruling (Task 6): aliases are limited to an explicit environment
// selector grammar and the filesystem mapping is internal. Repository paths are
// therefore derived only from validated IDs under fixed roots -- no
// caller-supplied path ever reaches the filesystem, and the logical
// `environmentKey` (which contains an IANA timezone slash) is never a path.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { EnvironmentError } from "./errors.mjs";
import { publishMutableRecord, readVerifiedArtifact } from "./store.mjs";

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
// The same safe-identifier shape the common snapshot envelope enforces: a
// filesystem-safe stem plus the first 16 hex characters of the content hash.
// It cannot contain "/", ":" or a leading dot, so it can never traverse.
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// A closed registry. An alias name that is not listed here does not exist, so
// a hostile selector can never become a directory name.
export const ALIAS_REGISTRY = Object.freeze({
  SC: Object.freeze({ edition: "SC", kind: "official" }),
  EN: Object.freeze({ edition: "EN", kind: "official" }),
  SC_WITH_EN_PRIOR: Object.freeze({ edition: "SC", kind: "proxy" }),
});

export const ALIAS_CHANNEL = "latest";

// Every immutable artifact kind the environment domain stores, mapped to its
// fixed directory. An unknown kind is refused rather than turned into a path.
export const DERIVED_ARTIFACT_DIRECTORIES = Object.freeze({
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
});

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isSafeArtifactId(value) {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function isFullHash(value) {
  return typeof value === "string" && FULL_HASH_PATTERN.test(value);
}

export function isRfc3339Instant(value) {
  return typeof value === "string" && RFC3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function assertAliasName(aliasName) {
  if (typeof aliasName !== "string" || !Object.hasOwn(ALIAS_REGISTRY, aliasName)) {
    fail("environment_not_found", "alias is not a registered environment selector", { aliasName });
  }
  return ALIAS_REGISTRY[aliasName];
}

export function parseEnvironmentSelector(selector) {
  if (typeof selector === "string") {
    const parts = selector.split("/");
    if (parts.length !== 2 || parts[1] !== ALIAS_CHANNEL || !Object.hasOwn(ALIAS_REGISTRY, parts[0])) {
      fail("environment_not_found", "selector is not a registered environment alias", { selector });
    }
    const entry = ALIAS_REGISTRY[parts[0]];
    return {
      mode: "alias",
      aliasName: parts[0],
      channel: ALIAS_CHANNEL,
      alias: selector,
      edition: entry.edition,
      kind: entry.kind,
    };
  }
  if (!isRecord(selector)) {
    fail("resolver_input_invalid", "selector must be an alias string or an immutable Manifest reference", {});
  }
  if (Object.hasOwn(selector, "alias")) {
    return parseEnvironmentSelector(selector.alias);
  }
  // A logical environment key identifies an environment but not a revision, so
  // it is never a selector -- multiple reviewed Manifests share one key.
  if (Object.hasOwn(selector, "environmentKey")) {
    fail("environment_not_found", "a logical environment key is not a selector", {
      reason: "environment_key_is_not_a_selector",
    });
  }
  const keys = Object.keys(selector).sort();
  if (keys.length !== 2 || keys[0] !== "contentHash" || keys[1] !== "manifestId") {
    fail("resolver_input_invalid", "a direct selector must be exactly { manifestId, contentHash }", {
      keys,
    });
  }
  if (!isSafeArtifactId(selector.manifestId) || !isFullHash(selector.contentHash)) {
    fail("resolver_input_invalid", "a direct selector needs a safe manifestId and its full content hash", {});
  }
  return {
    mode: "manifest",
    manifestId: selector.manifestId,
    contentHash: selector.contentHash,
  };
}

function assertRoot(root) {
  if (typeof root !== "string" || root.length === 0) {
    fail("resolver_input_invalid", "repository root must be a non-empty path", {});
  }
  return resolve(root);
}

export function manifestPath(root, manifestId) {
  if (!isSafeArtifactId(manifestId)) {
    fail("manifest_invalid", "manifestId is not a safe immutable identifier", { manifestId });
  }
  return join(assertRoot(root), "data", "environments", `${manifestId}.json`);
}

export function aliasRecordPath(root, aliasName) {
  assertAliasName(aliasName);
  return join(assertRoot(root), "data", "environment-aliases", aliasName, `${ALIAS_CHANNEL}.json`);
}

export function derivedArtifactPath(root, kind, snapshotId) {
  if (typeof kind !== "string" || !Object.hasOwn(DERIVED_ARTIFACT_DIRECTORIES, kind)) {
    fail("manifest_invalid", "unknown derived artifact kind", { kind });
  }
  if (!isSafeArtifactId(snapshotId)) {
    fail("manifest_invalid", "snapshotId is not a safe immutable identifier", { snapshotId });
  }
  return join(assertRoot(root), "data", "derived", DERIVED_ARTIFACT_DIRECTORIES[kind], `${snapshotId}.json`);
}

export function createRepository(repository) {
  if (!isRecord(repository)) {
    fail("resolver_input_invalid", "a repository { root } is required", {});
  }
  return { root: assertRoot(repository.root), io: repository.io };
}

// Low-level verified read that distinguishes "absent" from "present but
// invalid", so each caller can map absence to its own precise stable code
// (environment_not_found vs missing_representative_deck) without duplicating
// the store's verification or durability protocol.
export function readArtifactAt(repository, path, contract) {
  try {
    return { ok: true, value: readVerifiedArtifact(path, repository.io, contract) };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "EISDIR") {
      return { ok: false, reason: "absent" };
    }
    return { ok: false, reason: "invalid", error };
  }
}

export function buildAliasRecord({ alias, manifestId, manifestHash, updatedAt }) {
  const parsed = parseEnvironmentSelector(alias);
  if (parsed.mode !== "alias") {
    fail("environment_not_found", "an alias record needs a registered alias selector", { alias });
  }
  if (!isSafeArtifactId(manifestId)) {
    fail("manifest_invalid", "an alias record needs a safe manifestId", { manifestId });
  }
  if (!isFullHash(manifestHash)) {
    fail("manifest_invalid", "an alias record needs the Manifest's full content hash", {});
  }
  // `updatedAt` is an injected RFC 3339 instant: this library never reads host
  // clock time, so a caller that forgets it fails closed instead of stamping
  // an unverifiable time.
  if (!isRfc3339Instant(updatedAt)) {
    fail("manifest_invalid", "an alias record needs an injected RFC 3339 updatedAt instant", {
      reason: "updated_at_not_provided",
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    alias: parsed.alias,
    manifestId,
    manifestHash,
    updatedAt,
  });
}

export function verifyAliasRecord(record, aliasName) {
  const entry = assertAliasName(aliasName);
  if (!isRecord(record)) {
    fail("environment_not_found", "alias record is missing", { aliasName });
  }
  if (record.schemaVersion !== 1) {
    fail("environment_not_found", "unsupported alias record schema", { aliasName });
  }
  if (record.alias !== `${aliasName}/${ALIAS_CHANNEL}`) {
    fail("environment_not_found", "alias record does not name its own alias", { aliasName });
  }
  if (!isSafeArtifactId(record.manifestId)) {
    fail("environment_not_found", "alias record has no safe manifestId", { aliasName });
  }
  if (!isFullHash(record.manifestHash)) {
    fail("environment_not_found", "alias record has no full Manifest hash", { aliasName });
  }
  if (!isRfc3339Instant(record.updatedAt)) {
    fail("environment_not_found", "alias record has no RFC 3339 updatedAt instant", { aliasName });
  }
  return { record, entry };
}

export function readAliasRecord(repository, aliasName) {
  const path = aliasRecordPath(repository.root, aliasName);
  let raw;
  try {
    raw = JSON.parse((repository.io?.readFile ?? readFileSync)(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      fail("environment_not_found", "no Manifest is aliased for this environment", { aliasName });
    }
    fail("environment_not_found", "alias record could not be read", {
      aliasName,
      cause: error?.code ?? "unreadable",
    });
  }
  return verifyAliasRecord(raw, aliasName);
}

export function publishAliasRecord(repository, record) {
  const parsed = parseEnvironmentSelector(record.alias);
  return publishMutableRecord(
    aliasRecordPath(repository.root, parsed.aliasName),
    record,
    repository.io,
  );
}
