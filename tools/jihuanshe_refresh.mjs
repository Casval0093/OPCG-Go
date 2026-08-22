#!/usr/bin/env node
// Headless JiHuanShe source refresh, plus a visible ONE-TIME reauthentication command.
//
// This module is the composition layer: it drives Task 8's capture CLI as a child process,
// hands the exact raw bytes to Task 7's normalizer, and publishes the resulting immutable
// source snapshots through Task 2's store. It owns no Android knowledge of its own beyond the
// app's launch activity (for the visible login flow) and no snapshot semantics of its own.
//
// TWO LOCKS, FIXED ORDER -- refresh-publication, then avd-drive:
//
//   * The OUTER `refresh-publication` lock (this file) is acquired BEFORE the capture child is
//     spawned and stays held across capture, normalization, validation, and publication, so two
//     refreshes can never interleave their publications.
//   * The INNER `avd-drive` lock belongs to the child alone (tools/jihuanshe_lifecycle.mjs). The
//     child owns every UI operation and its own invocation cleanup. This process NEVER stops an
//     emulator after a NORMAL child return -- success or failure. Only when a child dies without
//     producing a valid CaptureResult does this process attempt recovery, and even then it
//     delegates the whole dead-owner proof / token revalidation / signal sequence to the
//     certified `recoverAbandonedCapture`, which refuses outright when identity cannot be
//     verified. This file contains no code path that signals an emulator during a refresh.
//
// PRIVACY. The RefreshResult carries no raw capture bytes, no participant identifiers, no
// credentials, no phone numbers, no session tokens, no pids/process tokens, no filesystem paths,
// and no child stderr. The child's stderr is reduced to a BYTE COUNT at the seam and the text is
// never retained; even the count never reaches the result. A child failure code is propagated
// only when it matches the KNOWN_CAPTURE_CODES allowlist -- free text from the child (which
// contains event titles and other raw UI strings) is never copied.
//
// A refresh publishes IMMUTABLE SOURCE SNAPSHOTS ONLY. It never writes under
// `data/environment-aliases/**` on any path: success, reuse, conflict, failure, or crash
// recovery. Advancing an alias belongs to Manifest publication, which is a different command.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EnvironmentError } from "../environment/errors.mjs";
import { verifySnapshot } from "../environment/snapshot.mjs";
import {
  publishImmutableArtifact,
  readVerifiedArtifact,
  recoverStaleTemps,
} from "../environment/store.mjs";
import { createCleanupStack, installTerminationHandlers } from "./jihuanshe_reader.mjs";
import { classifyHomeUi } from "./jihuanshe_capture.mjs";
import {
  OWNED_AVD,
  OWNED_SERIAL,
  cleanupOwnedLease,
  computeProcessStartToken,
  inspectOwnedAvd,
  recoverAbandonedCapture,
  startOwnedAvd,
  withAvdDriveLock,
} from "./jihuanshe_lifecycle.mjs";
import { normalizeJiHuanSheCapture } from "./jihuanshe_normalize.mjs";

// ---------------------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------------------

export const REFRESH_SCHEMA_VERSION = 1;
export const REFRESH_SOURCE = "jihuanshe";
export const REFRESH_LOCK_KIND = "refresh-publication";
const REFRESH_LOCK_SCHEMA_VERSION = 1;
const RECOVERY_LOCK_KIND = "refresh-recovery";

// The six failure stages, exactly. `complete` is the success stage, and `arguments` belongs to
// the CLI's own argument boundary (see usageEnvelope) -- neither is a refresh failure stage.
export const REFRESH_STAGES = Object.freeze([
  "lock", "capture", "normalize", "validate", "publish_snapshot", "cleanup",
]);
const SUCCESS_STAGE = "complete";
const ARGUMENT_STAGE = "arguments";

// The ten stable failure codes, exactly.
export const REFRESH_CODES = Object.freeze([
  "lock_busy",
  "reauth_required",
  "ui_contract_changed",
  "unsupported_capture_schema",
  "event_identity_ambiguous",
  "normalization_failed",
  "snapshot_validation_failed",
  "snapshot_publish_failed",
  "cleanup_failed",
  "event_conflict",
]);
const SUCCESS_CODE = "ok";
// Emitted ONLY by the CLI argument boundary, never by refresh/reauth/status themselves.
const ARGUMENT_CODE = "refresh_input_invalid";

const OPERATIONS = Object.freeze(["refresh", "reauth", "status"]);

// Exactly 16 MiB of child stdout. `spawnSync`'s maxBuffer enforces it and kills the child, so an
// oversized capture can never be parsed, normalized, or published.
export const CHILD_STDOUT_LIMIT_BYTES = 16 * 1024 * 1024;

// Every capture/lifecycle failure code this layer will repeat back. Task 8 raises the navigation
// codes as PLAIN Errors whose message begins `<code>: ...`, so its v2 envelope reports
// `code: "error"` with the real code inside `details.message`; the allowlist below is what makes
// extracting that token safe -- anything unlisted becomes "unrecognized" and the child's text is
// dropped.
export const KNOWN_CAPTURE_CODES = Object.freeze([
  "avd_lock_corrupt",
  "avd_lock_held",
  "avd_process_vanished",
  "avd_recovery_lost_race",
  "avd_spawn_failed",
  "enumeration_did_not_stabilize",
  "event_identity_ambiguous",
  "event_identity_mismatch",
  "event_identity_unverifiable",
  "event_key_not_found",
  "event_unreachable",
  "foreign_avd",
  "lease_recovery_refused",
  "lifecycle_self_unverifiable",
  "lifecycle_timeout",
  "no_events_in_window",
  "reauth_dependency_missing",
  "reauth_required",
]);
const KNOWN_CAPTURE_CODE_SET = new Set(KNOWN_CAPTURE_CODES);

// Child code -> stable refresh code. Everything not named here is a contract deviation from the
// app's rendered surface or the child's own output contract, i.e. `ui_contract_changed`; the
// precise child code always survives in `details.captureCode`, so nothing is lost by the
// coarser bucket.
const CAPTURE_CODE_TO_REFRESH_CODE = new Map([
  ["reauth_required", "reauth_required"],
  ["avd_lock_held", "lock_busy"],
  ["avd_recovery_lost_race", "lock_busy"],
  ["event_identity_ambiguous", "event_identity_ambiguous"],
]);

const CAPTURE_SCHEMA_VERSION = 2;
const SUPPORTED_CAPTURE_SURFACES = Object.freeze(["tournament", "tournament-batch", "market"]);

// Immutable source-snapshot layout: data/sources/<edition>/jihuanshe/{tournaments,market}/.
// A closed registry -- an unknown edition or kind is refused rather than turned into a path.
const EDITION_DIRECTORIES = Object.freeze({ SC: "sc", EN: "en" });
const KIND_DIRECTORIES = Object.freeze({ tournament_event: "tournaments", market: "market" });

const NATIVE_SC_ENVIRONMENT = Object.freeze({ edition: "SC", metagameRegion: "CN", language: "zh-Hans" });

const DEFAULT_FORMAT_ID = "standard-block2-op16";
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_PARSER_VERSION = "jihuanshe-normalizer-v1";
const DEFAULT_MAPPING_RELATIVE = join("data", "mappings", "jihuanshe", "v1.json");
const DEFAULT_CAPTURE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_LOGIN_POLL_MS = 1_000;
const DEFAULT_STOP_POLL_MS = 250;
const DEFAULT_STOP_ATTEMPTS = 40;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE_MODULE_PATH = join(REPOSITORY_ROOT, "tools", "jihuanshe_capture.mjs");
const DEFAULT_REFRESH_LOCK_PATH = join(tmpdir(), "jihuanshe-refresh-publication.lock");
const DEFAULT_AVD_LOCK_PATH = join(tmpdir(), "jihuanshe-avd-drive.lock");

// Mirrors tools/jihuanshe_capture.mjs. Duplicated rather than imported because that file does
// not export it and Task 9 must not modify another task's module; it is the app's OWN public
// launcher, which is exactly the official login entry point.
const APP_PACKAGE = "com.jihuanshe";
const APP_LAUNCH_ACTIVITY = `${APP_PACKAGE}/com.jihuanshe.ui.page.SplashActivity`;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EVENT_KEY_PATTERN = /^jihuanshe:tournament:(?:fallback:)?[A-Za-z0-9._-]{1,80}$/u;
const PHONE_NUMBER_PATTERN = /1[3-9]\d{9}/u;
const CAPTURE_CODE_PREFIX_PATTERN = /^([a-z][a-z0-9_]{2,63}):/u;
// The immutable-id shape Task 2 guarantees: a filesystem-safe stem plus 16 hex characters.
const SNAPSHOT_ID_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*)-([0-9a-f]{16})$/u;
const MAX_REPORTED_CONFLICTS = 20;

function fail(code, message, details = {}) {
  throw new EnvironmentError(code, `${code}: ${message}`, details);
}

function inputInvalid(message, details = {}) {
  fail(ARGUMENT_CODE, message, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// ---------------------------------------------------------------------------------------
// RefreshResult construction, validation, and exit mapping
// ---------------------------------------------------------------------------------------

const RESULT_KEYS = Object.freeze([
  "schemaVersion", "source", "operation", "status", "stage", "code", "lifecycle", "published", "warnings", "details",
]);
const REQUIRED_RESULT_KEYS = Object.freeze(RESULT_KEYS.filter((key) => key !== "details"));
const LIFECYCLE_KEYS = Object.freeze(["stateBefore", "startedByInvocation", "launchMode", "cleanedUp"]);

const UNKNOWN_LIFECYCLE = Object.freeze({
  stateBefore: "unknown", startedByInvocation: false, launchMode: null, cleanedUp: false,
});

function buildResult({
  operation,
  status,
  stage,
  code,
  lifecycle = UNKNOWN_LIFECYCLE,
  snapshotIds = [],
  warnings = [],
  details,
}) {
  const result = {
    schemaVersion: REFRESH_SCHEMA_VERSION,
    source: REFRESH_SOURCE,
    operation,
    status,
    stage,
    code,
    lifecycle: {
      stateBefore: lifecycle.stateBefore,
      startedByInvocation: lifecycle.startedByInvocation === true,
      launchMode: lifecycle.launchMode ?? null,
      cleanedUp: lifecycle.cleanedUp === true,
    },
    published: { snapshotIds: [...snapshotIds] },
    warnings: sortedUnique(warnings.map((warning) => sanitizeWarning(warning))),
  };
  if (isRecord(details) && Object.keys(details).length > 0) result.details = details;
  return result;
}

function okResult(fields) {
  return buildResult({ ...fields, status: "ok", stage: SUCCESS_STAGE, code: SUCCESS_CODE });
}

function errorResult(fields) {
  return buildResult({ ...fields, status: "error" });
}

// A warning may embed an event key (`event_conflict:<eventKey>`); sanitize that half the same way
// the details block does, so a hostile provider id cannot smuggle text into the output.
function sanitizeWarning(warning) {
  if (typeof warning !== "string") return "unrecognized_warning";
  const separator = warning.indexOf(":");
  if (separator === -1) return warning;
  const head = warning.slice(0, separator);
  if (head !== "event_conflict") return warning;
  return `event_conflict:${sanitizeEventKey(warning.slice(separator + 1))}`;
}

// I1: `published.snapshotIds` and `details.conflicts[].snapshotId` are the two places a provider
// event id re-enters the result AFTER sanitizeEventKey has redacted it.
//
// I-2 (final fix wave) narrowed this to a RESIDUAL, second line of defence. The normalizer now
// redacts a non-publishable provider event id at birth, so nothing this process normalizes can
// arrive here phone-shaped; what still can is an id read off DISK, from an artifact published by
// an older build (`existingEvidence` in publishCandidates).
//
// The redacted FORM changed with it. It used to be `sha256Canonical(stem).slice(7, 23)` -- 64
// unsalted bits over a fully known 11-digit template, measured at 1.22M candidates/s, i.e. the
// whole CN mobile space in about two core-hours. That is obfuscation, not redaction. The form
// below carries no preimage at all: a fixed marker plus the artifact's OWN 16-hex content-hash
// suffix, which is a digest of the snapshot body and keeps the file locatable by hash.
export function sanitizeSnapshotId(snapshotId) {
  if (typeof snapshotId !== "string" || snapshotId.length === 0) return "redacted";
  const match = SNAPSHOT_ID_PATTERN.exec(snapshotId);
  if (!match) return "redacted";
  const [, stem, suffix] = match;
  if (PHONE_NUMBER_PATTERN.test(stem)) {
    return `jihuanshe-tournament-redacted-${suffix}`;
  }
  return snapshotId;
}

// An event key has no content-hash suffix to keep, so the redacted form is the bare marker. The
// conflict record that carries it also carries the sanitized snapshotId, which is what
// distinguishes two redacted events from one another.
export function sanitizeEventKey(eventKey) {
  if (typeof eventKey !== "string" || !EVENT_KEY_PATTERN.test(eventKey) || PHONE_NUMBER_PATTERN.test(eventKey)) {
    return "jihuanshe:tournament:redacted";
  }
  return eventKey;
}

export function formatRefreshResult(result) {
  if (!isRecord(result)) fail("refresh_result_invalid", "result must be an object");
  for (const key of Object.keys(result)) {
    if (!RESULT_KEYS.includes(key)) {
      fail("refresh_result_invalid", "result carries a field outside the sanitized allowlist", { key });
    }
  }
  for (const key of REQUIRED_RESULT_KEYS) {
    if (!Object.hasOwn(result, key)) fail("refresh_result_invalid", "result is missing a required field", { key });
  }
  if (result.schemaVersion !== REFRESH_SCHEMA_VERSION) {
    fail("refresh_result_invalid", "unsupported result schemaVersion", { schemaVersion: result.schemaVersion });
  }
  if (result.source !== REFRESH_SOURCE) fail("refresh_result_invalid", "unexpected result source");
  if (!OPERATIONS.includes(result.operation)) fail("refresh_result_invalid", "unknown operation");
  if (result.status !== "ok" && result.status !== "error") fail("refresh_result_invalid", "unknown status");
  if (result.stage !== SUCCESS_STAGE && result.stage !== ARGUMENT_STAGE && !REFRESH_STAGES.includes(result.stage)) {
    fail("refresh_result_invalid", "stage is not a declared stage", { stage: result.stage });
  }
  if (result.code !== SUCCESS_CODE && result.code !== ARGUMENT_CODE && !REFRESH_CODES.includes(result.code)) {
    fail("refresh_result_invalid", "code is not a declared stable code", { code: result.code });
  }
  if (!isRecord(result.lifecycle) || LIFECYCLE_KEYS.some((key) => !Object.hasOwn(result.lifecycle, key))) {
    fail("refresh_result_invalid", "lifecycle block is incomplete");
  }
  if (!isRecord(result.published) || !Array.isArray(result.published.snapshotIds)
      || result.published.snapshotIds.some((id) => typeof id !== "string")) {
    fail("refresh_result_invalid", "published.snapshotIds must be an array of strings");
  }
  if (!Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== "string")) {
    fail("refresh_result_invalid", "warnings must be an array of strings");
  }
  let rendered;
  try {
    rendered = JSON.stringify(result);
  } catch (error) {
    fail("refresh_result_invalid", "result is not serializable JSON", { cause: error?.code ?? "unserializable" });
  }
  if (typeof rendered !== "string") fail("refresh_result_invalid", "result is not serializable JSON");
  return `${rendered}\n`;
}

// I6: printing must never throw. A result that formatRefreshResult refuses is an internal bug,
// and the honest response is one sanitized fallback object plus exit 1 -- not an unhandled
// rejection that prints a stack trace and NO JSON at all.
export function renderRefreshResult(result) {
  try {
    return { text: formatRefreshResult(result), exitCode: refreshExitCode(result) };
  } catch (error) {
    const fallback = buildResult({
      operation: "status",
      status: "error",
      stage: "cleanup",
      code: "cleanup_failed",
      details: { reason: sanitizeCode(error?.code) },
    });
    return { text: formatRefreshResult(fallback), exitCode: 1 };
  }
}

export function refreshExitCode(result) {
  if (!isRecord(result)) return 1;
  if (result.status === "ok" && result.code === SUCCESS_CODE) return 0;
  if (result.status === "error" && result.code === "reauth_required") return 2;
  return 1;
}

// ---------------------------------------------------------------------------------------
// Argument boundary
// ---------------------------------------------------------------------------------------

const VALUE_FLAGS = Object.freeze({
  "--root": "root",
  "--as-of": "asOf",
  "--window-days": "windowDays",
  "--max-scrolls": "maxScrolls",
  "--format-id": "formatId",
  "--time-zone": "timeZone",
  "--mapping": "mappingPath",
  "--parser-version": "parserVersion",
  "--refresh-lock-path": "refreshLockPath",
  "--avd-lock-path": "avdLockPath",
  "--retain-raw": "retainRawDir",
  "--adb": "adbPath",
  "--emulator": "emulatorPath",
  "--ps": "psPath",
  "--login-timeout": "loginTimeoutSeconds",
  "--capture-timeout": "captureTimeoutSeconds",
});
const INTEGER_OPTIONS = Object.freeze(["windowDays", "maxScrolls", "loginTimeoutSeconds", "captureTimeoutSeconds"]);
const REFRESH_TARGETS = Object.freeze(["tournaments", "market", "all"]);

// M3: the zone is validated for EVERY invocation, not only when it is needed to default
// `--as-of`. An unusable zone otherwise booted an emulator and ran a real capture before failing
// at normalization.
function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    inputInvalid("--time-zone is not a usable IANA time zone");
  }
  return timeZone;
}

function localDateIn(timeZone, instant = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) inputInvalid("a command is required");
  const command = argv[0];
  if (!OPERATIONS.includes(command)) inputInvalid("unknown command", { expected: OPERATIONS });

  let index = 1;
  let target;
  if (command === "refresh") {
    target = argv[1];
    if (!REFRESH_TARGETS.includes(target)) inputInvalid("refresh needs a target", { expected: REFRESH_TARGETS });
    index = 2;
  }

  const options = { command, target };
  for (; index < argv.length; index += 1) {
    const flag = argv[index];
    const name = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : undefined;
    // Phone numbers, SMS codes, and credentials are not accepted as arguments at all: they are
    // simply not in the flag table, so this is the branch that refuses them.
    if (name === undefined) inputInvalid("unknown argument", { argument: String(flag).slice(0, 32) });
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      inputInvalid("argument is missing its value", { argument: flag });
    }
    options[name] = value;
    index += 1;
  }

  for (const name of INTEGER_OPTIONS) {
    if (options[name] === undefined) continue;
    const parsed = Number(options[name]);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      inputInvalid(`${name} must be a positive integer`, { option: name });
    }
    options[name] = parsed;
  }

  options.root = options.root === undefined ? REPOSITORY_ROOT : resolve(options.root);
  options.formatId = options.formatId ?? DEFAULT_FORMAT_ID;
  options.timeZone = assertTimeZone(options.timeZone ?? DEFAULT_TIME_ZONE);
  options.parserVersion = options.parserVersion ?? DEFAULT_PARSER_VERSION;
  options.mappingPath = options.mappingPath === undefined
    ? join(options.root, DEFAULT_MAPPING_RELATIVE)
    : resolve(options.mappingPath);
  options.refreshLockPath = options.refreshLockPath === undefined
    ? DEFAULT_REFRESH_LOCK_PATH
    : resolve(options.refreshLockPath);
  options.avdLockPath = options.avdLockPath === undefined ? DEFAULT_AVD_LOCK_PATH : resolve(options.avdLockPath);
  if (options.retainRawDir !== undefined) options.retainRawDir = resolve(options.retainRawDir);
  if (options.loginTimeoutSeconds !== undefined) options.loginTimeoutMs = options.loginTimeoutSeconds * 1_000;
  if (options.captureTimeoutSeconds !== undefined) options.captureTimeoutMs = options.captureTimeoutSeconds * 1_000;

  // A tournament window is required and never defaulted -- the acquisition window is evidence
  // metadata, not a convenience. `asOf` for a market-only refresh defaults at this boundary
  // (the only place a host clock is read).
  if (command === "refresh" && (target === "tournaments" || target === "all")) {
    if (options.asOf === undefined || options.windowDays === undefined) {
      inputInvalid("refresh tournaments needs --as-of DATE and --window-days DAYS");
    }
  }
  options.asOf = options.asOf ?? localDateIn(options.timeZone);
  if (!LOCAL_DATE_PATTERN.test(options.asOf)) inputInvalid("--as-of must be a local date (YYYY-MM-DD)");
  return options;
}

// ---------------------------------------------------------------------------------------
// Injectable seams. Every default is the real implementation; tests replace them wholesale and
// perform NO live emulator, ADB, or child-process operation.
// ---------------------------------------------------------------------------------------

function resolvePs(explicit) {
  for (const candidate of [explicit, "/bin/ps", "/usr/bin/ps"].filter(Boolean)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function defaultProcessStartTime(pid, options = {}) {
  const ps = resolvePs(options.psPath);
  if (ps === null) return null;
  const result = spawnSync(ps, ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8", maxBuffer: 64 * 1024, timeout: 20_000, shell: false,
  });
  if (result.error || result.status !== 0) return null;
  const lstart = String(result.stdout).replace(/\r?\n+$/u, "");
  return lstart.length > 0 ? lstart : null;
}

// The ONLY child spawn in this file: a fixed executable (this Node binary), a fixed argument
// array, `shell: false`, stdin ignored, and a hard 16 MiB stdout ceiling. `stderr` is reduced to
// a byte count here and the text is dropped on the floor -- there is no channel by which it can
// reach a RefreshResult.
function defaultCaptureChild(request) {
  const result = spawnSync(process.execPath, request.argv, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: CHILD_STDOUT_LIMIT_BYTES,
    timeout: request.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS,
  });
  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderrBytes: Buffer.isBuffer(result.stderr) ? result.stderr.length : 0,
    exitCode: typeof result.status === "number" ? result.status : null,
    killedBySignal: typeof result.signal === "string" && result.signal.length > 0,
    stdoutTruncated: result.error?.code === "ENOBUFS",
  };
}

function defaultReadMapping(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail("mapping_unreadable", "the archetype mapping file could not be read", {
      cause: error?.code ?? "unreadable",
    });
  }
  try {
    const mapping = JSON.parse(text);
    if (!isRecord(mapping)) fail("mapping_invalid", "the mapping file must contain a JSON object");
    return mapping;
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail("mapping_invalid", "the mapping file does not contain valid JSON", { cause: "parse_error" });
  }
  return undefined;
}

function defaultListSnapshots(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort()
    .map((name) => readVerifiedArtifact(join(directory, name)));
}

// Reads (never writes) the avd-drive lock metadata so it can be handed to the certified
// recoverAbandonedCapture. Shape-checked, and a corrupt file is a hard `undefined` rather than a
// guess -- an unreadable lock is never turned into a signal target.
function defaultReadAvdLock(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return undefined;
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(metadata) || metadata.kind !== "avd-drive" || !isRecord(metadata.owner)) return undefined;
  return metadata;
}

function defaultSignalProcess(pid, signal) {
  try {
    return process.kill(pid, signal);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function runAdb(options, args, { allowFailure = false, timeout = 30_000 } = {}) {
  const adb = options.adbPath ?? process.env.JIHUANSHE_ADB ?? "adb";
  const result = spawnSync(adb, ["-s", OWNED_SERIAL, ...args], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout, shell: false,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail("adb_command_failed", "an adb command required for the visible login flow failed", {
      cause: result.error?.code ?? `status_${result.status}`,
    });
  }
  return result;
}

// Cold-launches the app's OWN launcher so the owner sees the official login screen. No
// credential is typed, read, stored, or replayed by this process.
function defaultLaunchLoginScreen(options) {
  runAdb(options, ["shell", "input", "keyevent", "KEYCODE_WAKEUP"], { allowFailure: true });
  runAdb(options, ["shell", "wm", "dismiss-keyguard"], { allowFailure: true });
  runAdb(options, ["shell", "am", "force-stop", APP_PACKAGE]);
  runAdb(options, ["shell", "am", "start", "-W", "-n", APP_LAUNCH_ACTIVITY]);
}

function defaultReadHomeState(options) {
  const remote = `/sdcard/jihuanshe-refresh-${process.pid}.xml`;
  try {
    runAdb(options, ["shell", "uiautomator", "dump", remote]);
    const dump = runAdb(options, ["exec-out", "cat", remote]);
    return classifyHomeUi(String(dump.stdout));
  } catch {
    return "unknown";
  } finally {
    runAdb(options, ["shell", "rm", "-f", remote], { allowFailure: true });
  }
}

// Optional diagnostic retention. Refuses a symlink outright, refuses a directory that is not
// exactly 0700, creates the file with `wx` at 0600, writes the EXACT bytes, and fsyncs. Returns
// only a sanitized status -- never the path.
// I5: `resolve()` is lexical, so a symlinked PARENT component redirected the most sensitive
// bytes in the system into a directory the caller never named. The deepest component that already
// exists is re-checked against its own parent's REAL path: if the two disagree, some component of
// the caller-supplied path is a redirection and retention is refused before anything is created.
// Comparing against the parent's realpath (rather than requiring realpath === lexical outright) is
// what keeps platform-managed symlinks such as macOS `/var -> /private/var` from refusing every
// ordinary temp path.
function retentionPathRedirects(target) {
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return true;
    existing = parent;
  }
  const parent = dirname(existing);
  if (parent === existing) return false;
  try {
    return realpathSync(existing) !== join(realpathSync(parent), basename(existing));
  } catch {
    return true;
  }
}

function defaultRetainRaw({ directory, surface, bytes, now }) {
  const target = resolve(directory);
  // retentionPathRedirects already refuses a symlink at ANY component, the final one included
  // (the deepest existing component of `<dir>` IS the link), so no separate final-component
  // symlink branch survives here -- only "exists but is not a directory" is still reachable.
  if (retentionPathRedirects(target)) return { retained: false, reason: "symlink_refused" };
  let stats = lstatSync(target, { throwIfNoEntry: false });
  if (stats && !stats.isDirectory()) return { retained: false, reason: "not_a_directory" };
  if (!stats) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    chmodSync(target, 0o700);
    stats = lstatSync(target, { throwIfNoEntry: false });
    if (!stats || !stats.isDirectory()) return { retained: false, reason: "not_a_directory" };
  }
  if ((stats.mode & 0o777) !== 0o700) return { retained: false, reason: "directory_mode_refused" };

  const stamp = String(now ?? "").replace(/[^0-9A-Za-z]/gu, "-");
  const file = `${surface}-${stamp}-${randomUUID()}.json`;
  const path = join(target, file);
  if (!path.startsWith(`${target}${sep}`)) return { retained: false, reason: "path_escape_refused" };
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
    fsyncSync(fd);
  } catch (error) {
    return { retained: false, reason: error?.code === "EEXIST" ? "target_exists" : "write_refused" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { retained: true };
}

export const realDeps = Object.freeze({
  now: () => new Date().toISOString(),
  // A SEPARATE clock from `now()` on purpose: the stale-temp sweep compares against filesystem
  // mtimes, so it must read the same clock the filesystem does. Feeding it the logical/recorded
  // timestamp instead silently disables the sweep whenever the two disagree.
  filesystemNow: () => Date.now(),
  processStartTime: defaultProcessStartTime,
  // isOwnerAlive is deliberately ABSENT: ownerBlocksAcquisition falls back to
  // defaultIsOwnerAlive threaded through the RESOLVED processStartTime seam, so a caller that
  // overrides only the clock/ps seam still gets a consistent liveness check.
  captureChild: defaultCaptureChild,
  readMapping: defaultReadMapping,
  normalize: normalizeJiHuanSheCapture,
  verify: verifySnapshot,
  listSnapshots: defaultListSnapshots,
  publishSnapshot: (target, snapshot) => publishImmutableArtifact(target, snapshot),
  recoverStaleTemps: (directory, now) => recoverStaleTemps(directory, now),
  readAvdLock: defaultReadAvdLock,
  // The certified dead-owner proof / exact-token revalidation / signal sequence. This file never
  // reimplements it and never signals an emulator during a refresh.
  recoverAbandonedCapture: (metadata, options) => recoverAbandonedCapture(metadata, options),
  retainRaw: defaultRetainRaw,
  inspectAvd: (options) => inspectOwnedAvd(options),
  withAvdLock: (options, callback) => withAvdDriveLock(options, callback),
  startAvd: (options) => startOwnedAvd(options),
  cleanupLease: (lease, options) => cleanupOwnedLease(lease, options),
  signalProcess: defaultSignalProcess,
  launchLoginScreen: defaultLaunchLoginScreen,
  readHomeState: defaultReadHomeState,
  sleep: (ms) => new Promise((done) => {
    setTimeout(done, ms).unref?.();
  }),
});

function resolveDeps(deps) {
  const merged = { ...realDeps };
  for (const [key, value] of Object.entries(deps ?? {})) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

// ---------------------------------------------------------------------------------------
// The outer refresh-publication lock
// ---------------------------------------------------------------------------------------

function unlinkIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function tryCreateLockExclusive(path, metadata) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, `${JSON.stringify(metadata, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

// null = no lock, "corrupt" = present but unreadable/unexpected (never treated as free).
function readLockFile(path, kind) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return "corrupt";
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    return "corrupt";
  }
  if (!isRecord(metadata) || metadata.schemaVersion !== REFRESH_LOCK_SCHEMA_VERSION
      || metadata.kind !== kind || !isRecord(metadata.owner)) {
    return "corrupt";
  }
  return metadata;
}

function readRefreshLock(path) {
  return readLockFile(path, REFRESH_LOCK_KIND);
}

// I4: the recovery mutex is a race-NARROWER, not an authority -- the primary lock's `wx` create
// remains the only arbiter. So an unparseable mutex (a crash between `open(wx)` and the write
// leaves a zero-byte file) is reclaimable rather than permanent: treating it as held is what
// bricked every later refresh while `status` reported the lock free.
function recoveryMutexBlocks(mutexPath, deps) {
  const existing = readLockFile(mutexPath, RECOVERY_LOCK_KIND);
  if (existing === null || existing === "corrupt") return false;
  return ownerBlocksAcquisition(existing, deps);
}

function acquireRecoveryMutex(mutexPath, owner, deps) {
  const metadata = {
    schemaVersion: REFRESH_LOCK_SCHEMA_VERSION,
    kind: RECOVERY_LOCK_KIND,
    owner,
    createdAt: deps.now(),
  };
  if (tryCreateLockExclusive(mutexPath, metadata)) return true;
  if (recoveryMutexBlocks(mutexPath, deps)) return false;
  unlinkIfPresent(mutexPath);
  return tryCreateLockExclusive(mutexPath, metadata);
}

function defaultIsOwnerAlive(owner, deps) {
  const lstart = deps.processStartTime(owner.pid);
  if (typeof lstart !== "string" || lstart.length === 0) return false;
  let token;
  try {
    token = computeProcessStartToken(owner.pid, lstart);
  } catch {
    return true; // cannot recompute the token -> cannot prove death
  }
  return token === owner.processStartToken;
}

// Reclaiming is allowed ONLY when the recorded owner can be PROVEN dead: a missing pid or a
// missing process-start token means no proof is possible, so the lock stays put.
function ownerBlocksAcquisition(existing, deps) {
  if (existing === "corrupt") return true;
  const owner = existing.owner;
  if (!isRecord(owner) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return true;
  if (typeof owner.processStartToken !== "string" || owner.processStartToken.length === 0) return true;
  const alive = typeof deps.isOwnerAlive === "function"
    ? deps.isOwnerAlive(owner)
    : defaultIsOwnerAlive(owner, deps);
  return alive === true;
}

function ownerDescriptor(deps) {
  const lstart = deps.processStartTime(process.pid);
  if (typeof lstart !== "string" || lstart.length === 0) {
    fail("refresh_lock_unverifiable", "this invocation's own process start time is unreadable");
  }
  try {
    return { pid: process.pid, processStartToken: computeProcessStartToken(process.pid, lstart) };
  } catch {
    fail("refresh_lock_unverifiable", "this invocation's own process start token could not be computed");
  }
  return undefined;
}

function acquireRefreshLock(path, owner, deps, cleanupStack) {
  const metadata = {
    schemaVersion: REFRESH_LOCK_SCHEMA_VERSION,
    kind: REFRESH_LOCK_KIND,
    owner,
    createdAt: deps.now(),
  };
  mkdirSync(dirname(path), { recursive: true });
  if (tryCreateLockExclusive(path, metadata)) return true;

  const existing = readRefreshLock(path);
  if (existing === null) return tryCreateLockExclusive(path, metadata);
  if (ownerBlocksAcquisition(existing, deps)) return false;

  // A second mutex so two callers racing to reclaim the same dead lock cannot both win. It
  // carries a full owner descriptor (I4) so a later caller can prove it stale, and it is
  // registered on the termination stack for the window it is held.
  const recoveryMutex = `${path}.recovery`;
  if (!acquireRecoveryMutex(recoveryMutex, owner, deps)) return false;
  const unregisterMutex = cleanupStack ? cleanupStack.add(() => unlinkIfPresent(recoveryMutex)) : () => {};
  try {
    const current = readRefreshLock(path);
    if (current !== null && ownerBlocksAcquisition(current, deps)) return false;
    if (current !== null) unlinkIfPresent(path);
    return tryCreateLockExclusive(path, metadata);
  } finally {
    unregisterMutex();
    unlinkIfPresent(recoveryMutex);
  }
}

function releaseRefreshLock(path, owner) {
  const current = readRefreshLock(path);
  if (current === null || current === "corrupt") return;
  if (current.owner?.pid !== owner.pid || current.owner?.processStartToken !== owner.processStartToken) return;
  unlinkIfPresent(path);
}

function assertDistinctLockPaths(options) {
  const refreshLockPath = options.refreshLockPath ?? DEFAULT_REFRESH_LOCK_PATH;
  const avdLockPath = options.avdLockPath ?? DEFAULT_AVD_LOCK_PATH;
  if (resolve(refreshLockPath) === resolve(avdLockPath)) {
    fail("refresh_lock_path_invalid", "the refresh-publication lock must not share the avd-drive lock path");
  }
  return { refreshLockPath: resolve(refreshLockPath), avdLockPath: resolve(avdLockPath) };
}

// ---------------------------------------------------------------------------------------
// Capture-child orchestration
// ---------------------------------------------------------------------------------------

function captureRequestsFor(options) {
  const target = options.target ?? "tournaments";
  const requests = [];
  if (target === "tournaments" || target === "all") {
    if (typeof options.asOf !== "string" || !LOCAL_DATE_PATTERN.test(options.asOf)) {
      inputInvalid("a tournament refresh needs a local-date asOf");
    }
    if (!Number.isSafeInteger(options.windowDays) || options.windowDays <= 0) {
      inputInvalid("a tournament refresh needs a positive integer windowDays");
    }
    const argv = [
      CAPTURE_MODULE_PATH,
      "collect", "tournament-batch",
      "--as-of", options.asOf,
      "--window-days", String(options.windowDays),
      // Each child cleans up exactly what IT started and nothing else; a pre-existing emulator
      // is always left alone by the lifecycle module's own ownership rules.
      "--cleanup-started",
    ];
    if (options.maxScrolls !== undefined) {
      if (!Number.isSafeInteger(options.maxScrolls) || options.maxScrolls <= 0) {
        inputInvalid("maxScrolls must be a positive integer");
      }
      argv.push("--max-scrolls", String(options.maxScrolls));
    }
    requests.push({ surface: "tournament-batch", kind: "tournament_event", argv });
  }
  if (target === "market" || target === "all") {
    requests.push({
      surface: "market",
      kind: "market",
      argv: [CAPTURE_MODULE_PATH, "collect", "market", "--cleanup-started"],
    });
  }
  if (requests.length === 0) inputInvalid("unknown refresh target", { expected: REFRESH_TARGETS });
  return requests;
}

function parseSingleJsonObject(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.toString("utf8"));
  } catch {
    return null;
  }
  return isRecord(value) ? value : null;
}

function captureCodeOf(envelope) {
  const declared = typeof envelope.code === "string" ? envelope.code : "";
  if (KNOWN_CAPTURE_CODE_SET.has(declared)) return declared;
  // Task 8 reports a plain-Error failure as code "error" with `<code>: message` in details.
  const message = isRecord(envelope.details) && typeof envelope.details.message === "string"
    ? envelope.details.message
    : "";
  const match = CAPTURE_CODE_PREFIX_PATTERN.exec(message);
  if (match && KNOWN_CAPTURE_CODE_SET.has(match[1])) return match[1];
  return "unrecognized";
}

// Classifies a child outcome WITHOUT trusting anything but its shape. Never returns capture text.
function interpretChildOutcome(child, request) {
  if (!isRecord(child) || !Buffer.isBuffer(child.stdout)) {
    return { kind: "abnormal", childOutcome: "no_capture_result" };
  }
  if (child.stdoutTruncated === true) return { kind: "abnormal", childOutcome: "stdout_too_large" };
  // I2: the ceiling is enforced HERE as well, on the byte length we actually hold. Relying on
  // spawnSync's ENOBUFS truncation alone made the limit an untested property of the runtime, and
  // an injected/alternative child could hand over an oversized buffer with the flag unset.
  if (child.stdout.length > CHILD_STDOUT_LIMIT_BYTES) {
    return { kind: "abnormal", childOutcome: "stdout_too_large" };
  }
  if (child.killedBySignal === true) return { kind: "abnormal", childOutcome: "no_capture_result" };
  if (child.stdout.length === 0) return { kind: "abnormal", childOutcome: "no_capture_result" };

  const envelope = parseSingleJsonObject(child.stdout);
  if (envelope === null) return { kind: "abnormal", childOutcome: "malformed_stdout" };
  if (envelope.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
    return { kind: "schema", childOutcome: "unsupported_schema_version" };
  }
  if (envelope.status === "error") {
    return { kind: "childError", captureCode: captureCodeOf(envelope) };
  }
  if (envelope.status !== "ok") return { kind: "schema", childOutcome: "unsupported_status" };
  if (typeof envelope.surface !== "string" || !SUPPORTED_CAPTURE_SURFACES.includes(envelope.surface)) {
    return { kind: "schema", childOutcome: "unsupported_surface" };
  }
  if (envelope.surface !== request.surface) return { kind: "schema", childOutcome: "surface_mismatch" };
  if (child.exitCode !== 0) return { kind: "abnormal", childOutcome: "exit_nonzero" };
  // The child's documented success contract is exactly one JSON object on stdout and nothing on
  // stderr. Two reachable causes exist for stderr on an otherwise successful run -- a
  // post-capture cleanup diagnostic and dropped market rows -- and neither may be published
  // over; refresh fails closed and the operator reruns the capture directly to read the text.
  if (Number(child.stderrBytes) > 0) return { kind: "abnormal", childOutcome: "stderr_present" };
  return { kind: "ok", envelope };
}

const LAUNCH_MODES = Object.freeze(["headless", "visible"]);

function readChildLifecycle(envelope) {
  const lifecycle = isRecord(envelope.lifecycle) ? envelope.lifecycle : {};
  const launchMode = LAUNCH_MODES.includes(lifecycle.launchMode) ? lifecycle.launchMode : null;
  return {
    launchMode,
    startedByInvocation: lifecycle.startedByInvocation === true,
    cleanupRequested: isRecord(lifecycle.cleanup) && lifecycle.cleanup.requested === true,
  };
}

function aggregateLifecycle(lifecycles) {
  if (lifecycles.length === 0) return UNKNOWN_LIFECYCLE;
  const [first] = lifecycles;
  const started = lifecycles.filter((entry) => entry.startedByInvocation);
  return {
    stateBefore: first.startedByInvocation
      ? "offline"
      : (first.launchMode === null ? "unknown" : `${first.launchMode}-existing`),
    startedByInvocation: started.length > 0,
    launchMode: lifecycles.at(-1).launchMode,
    // Only a lease this invocation's children STARTED can be cleaned; an adopted emulator is
    // always left running, so `cleanedUp` stays false for it rather than claiming a cleanup.
    cleanedUp: started.length > 0 && started.every((entry) => entry.cleanupRequested),
  };
}

// The one place the outer process may touch avd-drive: after a child died WITHOUT a valid
// CaptureResult. The dead-owner proof, the exact-token revalidation, and the signalling all live
// inside the certified recoverAbandonedCapture; this only reads the lock and reports what
// happened. It never signals a process itself.
async function recoverChildLease(options, deps, warnings) {
  const metadata = deps.readAvdLock(options.avdLockPath);
  if (metadata === null) {
    warnings.push("avd_lease_absent");
    return { ok: true };
  }
  if (metadata === undefined) {
    warnings.push("avd_lease_unreadable");
    return { ok: false, reason: "avd_lease_unreadable" };
  }
  try {
    const outcome = await deps.recoverAbandonedCapture(metadata, { lockPath: options.avdLockPath });
    warnings.push(outcome?.recovered === true ? "avd_lease_recovered" : "avd_lease_not_recovered");
    return { ok: true };
  } catch (error) {
    const code = typeof error?.code === "string" && KNOWN_CAPTURE_CODE_SET.has(error.code)
      ? error.code
      : "unrecognized";
    if (code === "avd_lock_held") {
      // A live owner: the child may still be shutting down. Signal nothing, touch nothing.
      warnings.push("avd_lease_owner_alive");
      return { ok: true };
    }
    warnings.push("avd_lease_recovery_failed");
    return { ok: false, reason: code };
  }
}

// ---------------------------------------------------------------------------------------
// Normalization context, validation, and immutable publication
// ---------------------------------------------------------------------------------------

function repositoryRoot(options) {
  return resolve(options.root ?? REPOSITORY_ROOT);
}

function normalizationContext(options, deps) {
  const mappingPath = options.mappingPath === undefined
    ? join(repositoryRoot(options), DEFAULT_MAPPING_RELATIVE)
    : resolve(options.mappingPath);
  const mapping = deps.readMapping(mappingPath);
  const environment = {
    ...NATIVE_SC_ENVIRONMENT,
    formatId: options.formatId,
    timeZone: options.timeZone,
  };
  return {
    environment,
    formatId: options.formatId,
    timeZone: options.timeZone,
    asOf: options.asOf,
    parserVersion: options.parserVersion,
    mapping,
  };
}

function sourceSnapshotPath(options, snapshot) {
  const root = repositoryRoot(options);
  const edition = EDITION_DIRECTORIES[snapshot.environment?.edition];
  const surface = KIND_DIRECTORIES[snapshot.kind];
  if (edition === undefined || surface === undefined) {
    fail("snapshot_validation_failed", "snapshot kind or edition is outside the source registry", {
      kind: snapshot.kind,
    });
  }
  return join(root, "data", "sources", edition, "jihuanshe", surface, `${snapshot.snapshotId}.json`);
}

function sourceSnapshotDirectory(options, kind) {
  return join(repositoryRoot(options), "data", "sources", EDITION_DIRECTORIES.SC, "jihuanshe", KIND_DIRECTORIES[kind]);
}

function validateCandidate(snapshot, request, context, deps) {
  deps.verify(snapshot);
  if (snapshot.kind !== request.kind) {
    fail("snapshot_validation_failed", "candidate kind does not match the requested surface", {
      kind: snapshot.kind, expected: request.kind,
    });
  }
  if (!isRecord(snapshot.environment)) fail("snapshot_validation_failed", "candidate has no environment identity");
  for (const [key, value] of Object.entries(context.environment)) {
    if (snapshot.environment[key] !== value) {
      fail("snapshot_validation_failed", "candidate environment identity does not match the request", { key });
    }
  }
  if (Object.keys(snapshot.environment).length !== Object.keys(context.environment).length) {
    fail("snapshot_validation_failed", "candidate environment identity carries unexpected fields");
  }
  if (snapshot.asOf !== context.asOf) {
    fail("snapshot_validation_failed", "candidate asOf does not match the requested boundary");
  }
  if (snapshot.kind === "tournament_event"
      && (typeof snapshot.data?.eventKey !== "string" || typeof snapshot.data?.eventEvidenceHash !== "string")) {
    fail("snapshot_validation_failed", "tournament candidate is missing its event identity or evidence hash");
  }
  return snapshot;
}

// Existing evidence index: eventKey -> { snapshotId, eventEvidenceHash }. Any existing snapshot
// that cannot be read and verified fails the refresh closed -- without it, a conflict could not
// be ruled out, and silently publishing beside unreadable evidence is the worse outcome.
function indexExistingEvidence(options, deps) {
  const directory = sourceSnapshotDirectory(options, "tournament_event");
  let snapshots;
  try {
    snapshots = deps.listSnapshots(directory);
  } catch (error) {
    fail("snapshot_validation_failed", "an existing tournament snapshot could not be read and verified", {
      reason: typeof error?.code === "string" ? error.code : "unreadable",
    });
  }
  const index = new Map();
  for (const snapshot of snapshots) {
    const eventKey = snapshot?.data?.eventKey;
    if (typeof eventKey !== "string") continue;
    if (!index.has(eventKey)) index.set(eventKey, []);
    index.get(eventKey).push({
      snapshotId: snapshot.snapshotId,
      eventEvidenceHash: snapshot.data.eventEvidenceHash,
    });
  }
  return index;
}

function clearStaleTemps(directory, deps) {
  if (!existsSync(directory)) return;
  try {
    deps.recoverStaleTemps(directory, deps.filesystemNow());
  } catch {
    // A failed temp sweep never blocks publication: the no-clobber publish protocol is safe in
    // the presence of leftover temps, and nothing infers success from their presence.
  }
}

// ---------------------------------------------------------------------------------------
// refreshJiHuanShe
// ---------------------------------------------------------------------------------------

export async function refreshJiHuanShe(options, deps = realDeps) {
  const resolved = resolveDeps(deps);
  const { refreshLockPath } = assertDistinctLockPaths(options);
  const requests = captureRequestsFor(options);
  const owner = ownerDescriptor(resolved);

  if (!acquireRefreshLock(refreshLockPath, owner, resolved, options.cleanupStack)) {
    return errorResult({
      operation: "refresh",
      stage: "lock",
      code: "lock_busy",
      details: { reason: "refresh_publication_lock_held" },
    });
  }

  // A SIGINT/SIGTERM mid-refresh must still release the coordination lock -- the same reasoning
  // as the lifecycle module's own signal-path release. Without it the process dies before the
  // `finally` below and leaks the lock until a later invocation proves the owner dead.
  const unregister = options.cleanupStack
    ? options.cleanupStack.add(() => releaseRefreshLock(refreshLockPath, owner))
    : () => {};
  try {
    return await runRefresh({ ...options, refreshLockPath }, resolved, requests);
  } finally {
    unregister();
    releaseRefreshLock(refreshLockPath, owner);
  }
}

async function runRefresh(options, deps, requests) {
  const state = {
    snapshotIds: [],
    warnings: [],
    lifecycles: [],
    retained: 0,
    retentionRefusal: null,
    conflicts: [],
  };

  for (const request of requests) {
    const failure = await refreshOneSurface(options, deps, request, state);
    if (failure) return failure;
  }

  if (state.conflicts.length > 0) {
    return errorResult({
      operation: "refresh",
      stage: "publish_snapshot",
      code: "event_conflict",
      lifecycle: aggregateLifecycle(state.lifecycles),
      snapshotIds: state.snapshotIds,
      warnings: state.warnings,
      details: { ...retentionDetails(state), conflicts: state.conflicts.slice(0, MAX_REPORTED_CONFLICTS) },
    });
  }
  return okResult({
    operation: "refresh",
    lifecycle: aggregateLifecycle(state.lifecycles),
    snapshotIds: state.snapshotIds,
    warnings: state.warnings,
    details: retentionDetails(state),
  });
}

function retentionDetails(state) {
  if (state.retentionRefusal !== null) {
    return { retention: { retained: false, reason: state.retentionRefusal } };
  }
  if (state.retained > 0) return { retention: { retained: true, files: state.retained } };
  return {};
}

function surfaceFailure(state, fields) {
  return errorResult({
    operation: "refresh",
    lifecycle: aggregateLifecycle(state.lifecycles),
    snapshotIds: state.snapshotIds,
    warnings: state.warnings,
    ...fields,
    details: { ...retentionDetails(state), ...(fields.details ?? {}) },
  });
}

async function refreshOneSurface(options, deps, request, state) {
  // ----- capture -----------------------------------------------------------------------
  const child = await deps.captureChild({
    argv: request.argv,
    surface: request.surface,
    timeoutMs: options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS,
  });
  const outcome = interpretChildOutcome(child, request);

  if (outcome.kind === "schema") {
    return surfaceFailure(state, {
      stage: "capture",
      code: "unsupported_capture_schema",
      details: { childOutcome: outcome.childOutcome, surface: request.surface },
    });
  }
  if (outcome.kind === "childError") {
    // R1 (controller ruling): an empty capture window is not a failure -- there was simply
    // nothing to publish. It is recorded as a warning and the NEXT surface still runs, which is
    // why this cannot live in CAPTURE_CODE_TO_REFRESH_CODE (that table can only express
    // failures). No lifecycle is fabricated: a v2 error envelope carries no lifecycle block, so
    // `stateBefore` stays honestly `unknown` unless another surface reports one.
    if (outcome.captureCode === "no_events_in_window") {
      state.warnings.push("no_events_in_window");
      return undefined;
    }
    return surfaceFailure(state, {
      stage: "capture",
      code: CAPTURE_CODE_TO_REFRESH_CODE.get(outcome.captureCode) ?? "ui_contract_changed",
      details: { childOutcome: "capture_failed", captureCode: outcome.captureCode, surface: request.surface },
    });
  }
  if (outcome.kind === "abnormal") {
    // stderr on an otherwise valid success is a NORMAL return: the child finished and released
    // avd-drive itself, so no recovery is attempted for it.
    if (outcome.childOutcome === "stderr_present" || outcome.childOutcome === "exit_nonzero") {
      return surfaceFailure(state, {
        stage: "capture",
        code: "ui_contract_changed",
        details: { childOutcome: outcome.childOutcome, surface: request.surface },
      });
    }
    const recovery = await recoverChildLease(options, deps, state.warnings);
    if (!recovery.ok) {
      return surfaceFailure(state, {
        stage: "cleanup",
        code: "cleanup_failed",
        details: { childOutcome: outcome.childOutcome, recovery: recovery.reason, surface: request.surface },
      });
    }
    return surfaceFailure(state, {
      stage: "capture",
      code: "ui_contract_changed",
      details: { childOutcome: outcome.childOutcome, surface: request.surface },
    });
  }

  const { envelope } = outcome;
  state.lifecycles.push(readChildLifecycle(envelope));

  // ----- optional diagnostic retention of the exact bytes ------------------------------
  if (options.retainRawDir !== undefined) {
    let retention;
    try {
      retention = deps.retainRaw({
        directory: options.retainRawDir,
        surface: request.surface,
        bytes: child.stdout,
        now: deps.now(),
      });
    } catch {
      retention = { retained: false, reason: "write_refused" };
    }
    if (retention?.retained === true) state.retained += 1;
    else {
      state.retentionRefusal = typeof retention?.reason === "string" ? retention.reason : "write_refused";
      state.warnings.push("raw_retention_refused");
    }
  }

  // ----- normalize --------------------------------------------------------------------
  let context;
  let candidates;
  try {
    context = normalizationContext(options, deps);
    candidates = deps.normalize(child.stdout, context);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      fail("normalization_failed", "the normalizer produced no candidate snapshots");
    }
  } catch (error) {
    const code = error?.code === "event_identity_ambiguous" ? "event_identity_ambiguous" : "normalization_failed";
    return surfaceFailure(state, {
      stage: "normalize",
      code,
      details: { surface: request.surface, normalizerCode: sanitizeCode(error?.code) },
    });
  }

  // ----- validate ---------------------------------------------------------------------
  let existingEvidence = new Map();
  try {
    for (const candidate of candidates) validateCandidate(candidate, request, context, deps);
    if (request.kind === "tournament_event") existingEvidence = indexExistingEvidence(options, deps);
  } catch (error) {
    return surfaceFailure(state, {
      stage: "validate",
      code: "snapshot_validation_failed",
      details: { surface: request.surface, reason: sanitizeCode(error?.code) },
    });
  }

  // ----- publish ----------------------------------------------------------------------
  return publishCandidates(options, deps, request, state, candidates, existingEvidence);
}

function sanitizeCode(code) {
  if (typeof code !== "string" || code.length === 0 || code.length > 64 || !/^[a-z][a-z0-9_]*$/u.test(code)) {
    return "unrecognized";
  }
  return code;
}

function publishCandidates(options, deps, request, state, candidates, existingEvidence) {
  clearStaleTemps(sourceSnapshotDirectory(options, request.kind), deps);

  for (const candidate of candidates) {
    if (request.kind === "tournament_event") {
      const eventKey = candidate.data.eventKey;
      const versions = existingEvidence.get(eventKey) ?? [];
      const identical = versions.find((version) => version.eventEvidenceHash === candidate.data.eventEvidenceHash);
      if (identical) {
        // Same event, same projected evidence: reuse the original observation rather than
        // publishing a second copy that differs only in acquisition time.
        state.snapshotIds.push(sanitizeSnapshotId(identical.snapshotId));
        state.warnings.push("observation_reused");
        continue;
      }
      if (versions.length > 0) {
        // Changed evidence for an event we already hold: publish the new immutable version
        // BESIDE the old one, then report the conflict. Neither version is overwritten,
        // deleted, or promoted, and no alias moves.
        const published = publishOne(options, deps, state, candidate, request);
        if (published) return published;
        state.conflicts.push({
          eventKey: sanitizeEventKey(eventKey),
          snapshotId: sanitizeSnapshotId(candidate.snapshotId),
        });
        state.warnings.push(`event_conflict:${eventKey}`);
        continue;
      }
    }
    const published = publishOne(options, deps, state, candidate, request);
    if (published) return published;
  }
  return undefined;
}

// Publishes one candidate. Returns a failure result, or undefined on success. A failure NEVER
// rolls back an already published snapshot: previously published ids stay in `published`, the
// files stay on disk, and nothing is fabricated for the surface that failed.
function publishOne(options, deps, state, candidate, request) {
  let target;
  try {
    target = sourceSnapshotPath(options, candidate);
  } catch (error) {
    return surfaceFailure(state, {
      stage: "validate",
      code: "snapshot_validation_failed",
      details: { surface: request.surface, reason: sanitizeCode(error?.code) },
    });
  }
  try {
    deps.publishSnapshot(target, candidate);
  } catch (error) {
    return surfaceFailure(state, {
      stage: "publish_snapshot",
      code: "snapshot_publish_failed",
      details: { surface: request.surface, reason: sanitizeCode(error?.code) },
    });
  }
  state.snapshotIds.push(sanitizeSnapshotId(candidate.snapshotId));
  return undefined;
}

// ---------------------------------------------------------------------------------------
// statusJiHuanShe -- read-only. Starts nothing, stops nothing, captures nothing, publishes
// nothing, and never acquires either lock.
// ---------------------------------------------------------------------------------------

const AVD_STATES = Object.freeze(["offline", "headless-existing", "visible-existing"]);

function launchModeForState(state) {
  if (state === "headless-existing") return "headless";
  if (state === "visible-existing") return "visible";
  return null;
}

function countSnapshots(options, deps, kind) {
  try {
    return deps.listSnapshots(sourceSnapshotDirectory(options, kind)).length;
  } catch {
    return 0;
  }
}

export async function statusJiHuanShe(options, deps = realDeps) {
  const resolved = resolveDeps(deps);
  const warnings = [];
  let avdState = "unknown";
  try {
    const inspected = resolved.inspectAvd(avdLifecycleOptions(options));
    avdState = AVD_STATES.includes(inspected?.state) ? inspected.state : "unknown";
  } catch {
    avdState = "unknown";
  }
  if (avdState === "unknown") warnings.push("avd_state_unknown");

  // I4: `status` reports the recovery mutex too, and folds it into `refreshLockHeld`, so status
  // and refresh can never disagree about whether a refresh would be refused.
  const lockPath = resolve(options.refreshLockPath ?? DEFAULT_REFRESH_LOCK_PATH);
  const lock = readRefreshLock(lockPath);
  const primaryHeld = lock !== null && ownerBlocksAcquisition(lock, resolved);
  const recoveryPending = recoveryMutexBlocks(`${lockPath}.recovery`, resolved);
  const refreshLockHeld = primaryHeld || recoveryPending;

  return okResult({
    operation: "status",
    lifecycle: {
      stateBefore: avdState,
      startedByInvocation: false,
      launchMode: launchModeForState(avdState),
      cleanedUp: false,
    },
    warnings,
    details: {
      avdState,
      refreshLockHeld,
      recoveryPending,
      snapshotCounts: {
        tournaments: countSnapshots(options, resolved, "tournament_event"),
        market: countSnapshots(options, resolved, "market"),
      },
    },
  });
}

// ---------------------------------------------------------------------------------------
// reauthJiHuanShe -- the ONLY command that may open a visible emulator, and only when the owner
// asks for it explicitly. Phone numbers, SMS codes, and session tokens are never accepted,
// stored, read, or replayed; the owner types the code into the emulator itself.
// ---------------------------------------------------------------------------------------

function avdLifecycleOptions(options) {
  const lifecycleOptions = { lockPath: resolve(options.avdLockPath ?? DEFAULT_AVD_LOCK_PATH) };
  if (options.adbPath !== undefined) lifecycleOptions.adbPath = options.adbPath;
  if (options.emulatorPath !== undefined) lifecycleOptions.emulatorPath = options.emulatorPath;
  if (options.psPath !== undefined) lifecycleOptions.psPath = options.psPath;
  return lifecycleOptions;
}

function leaseStateLabel(lease) {
  if (!isRecord(lease)) return "unknown";
  if (lease.startedByInvocation === true) return "offline";
  return LAUNCH_MODES.includes(lease.launchMode) ? `${lease.launchMode}-existing` : "unknown";
}

function reauthFailure(fields) {
  return errorResult({ operation: "reauth", ...fields });
}

// Stops ONLY the exact headless process the lock handed over, and only after an immediate live
// recheck of pid + process-start token + AVD name (inspectOwnedAvd corroborates all three).
// Ambiguous or mismatched ownership sends no signal at all.
async function stopExactHeadlessProcess(options, deps, lease) {
  let live;
  try {
    live = deps.inspectAvd(avdLifecycleOptions(options));
  } catch {
    return { ok: false, reason: "avd_identity_unverifiable" };
  }
  if (!isRecord(live) || live.state !== "headless-existing" || !isRecord(live.lease)) {
    return { ok: false, reason: "avd_identity_unverifiable" };
  }
  if (live.lease.pid !== lease.pid
      || live.lease.processStartToken !== lease.processStartToken
      || live.lease.avd !== lease.avd
      || live.lease.avd !== OWNED_AVD) {
    return { ok: false, reason: "avd_identity_unverifiable" };
  }

  deps.signalProcess(lease.pid, "SIGTERM");
  const attempts = options.stopAttempts ?? DEFAULT_STOP_ATTEMPTS;
  const pollMs = options.stopPollMs ?? DEFAULT_STOP_POLL_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await deps.sleep(pollMs);
    let current;
    try {
      current = deps.inspectAvd(avdLifecycleOptions(options));
    } catch {
      return { ok: false, reason: "avd_identity_unverifiable" };
    }
    if (!isRecord(current) || current.state === "offline") return { ok: true };
    if (!isRecord(current.lease)
        || current.lease.pid !== lease.pid
        || current.lease.processStartToken !== lease.processStartToken) {
      // Something else now owns the port: never signal it.
      return { ok: false, reason: "avd_identity_unverifiable" };
    }
  }
  return { ok: false, reason: "avd_stop_timeout" };
}

async function waitForReadyHome(options, deps) {
  const timeoutMs = options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const pollMs = options.loginPollMs ?? DEFAULT_LOGIN_POLL_MS;
  const attempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollMs)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let state;
    try {
      state = await deps.readHomeState(avdLifecycleOptions(options));
    } catch {
      state = "unknown";
    }
    if (state === "ready") return true;
    // `reauth_required` is the EXPECTED state here -- the owner is mid-login -- so it keeps
    // polling rather than aborting the way an ordinary capture would.
    await deps.sleep(pollMs);
  }
  return false;
}

export async function reauthJiHuanShe(options, deps = realDeps) {
  const resolved = resolveDeps(deps);
  assertDistinctLockPaths(options);
  try {
    return await resolved.withAvdLock(
      { ...avdLifecycleOptions(options), launchMode: "visible", cleanupStartedOnFinish: false },
      async (lease) => reauthUnderAvdLock(options, resolved, lease),
    );
  } catch (error) {
    const code = sanitizeCode(error?.code);
    if (code === "avd_lock_held" || code === "avd_recovery_lost_race") {
      return reauthFailure({ stage: "lock", code: "lock_busy", details: { reason: "avd_drive_lock_held" } });
    }
    if (error instanceof EnvironmentError && !KNOWN_CAPTURE_CODE_SET.has(code)) throw error;
    return reauthFailure({ stage: "cleanup", code: "cleanup_failed", details: { reason: code } });
  }
}

// Stops exactly the lease this invocation started, reporting whether it really went away. A
// throwing cleanup is a false, not an escape: the caller warns `visible_avd_left_running`.
async function stopStartedVisibleLease(options, deps, visibleLease) {
  try {
    const cleanup = await deps.cleanupLease(visibleLease, avdLifecycleOptions(options));
    return cleanup?.cleaned === true;
  } catch {
    return false;
  }
}

async function abortReauth(options, deps, context) {
  let cleanedUp = false;
  if (context.startedHere) {
    cleanedUp = await stopStartedVisibleLease(options, deps, context.visibleLease);
    if (!cleanedUp) context.warnings.push("visible_avd_left_running");
  }
  return reauthFailure({
    stage: "cleanup",
    code: "cleanup_failed",
    lifecycle: {
      stateBefore: context.stateBefore,
      startedByInvocation: context.startedHere,
      launchMode: context.startedHere ? "visible" : null,
      cleanedUp,
    },
    warnings: context.warnings,
    details: { reason: context.reason },
  });
}

async function reauthUnderAvdLock(options, deps, lease) {
  const stateBefore = leaseStateLabel(lease);
  const warnings = [];
  let visibleLease = null;
  let startedHere = false;

  if (!isRecord(lease)) {
    return reauthFailure({
      stage: "cleanup",
      code: "cleanup_failed",
      lifecycle: { stateBefore, startedByInvocation: false, launchMode: null, cleanedUp: false },
      details: { reason: "avd_lease_unavailable" },
    });
  }

  if (lease.startedByInvocation === true) {
    // The lock's own ensure-running step started the AVD, and reauth always asks for a visible
    // launch, so a headless start here means the request was not honoured: fail closed.
    if (lease.launchMode !== "visible") {
      return reauthFailure({
        stage: "cleanup",
        code: "cleanup_failed",
        lifecycle: { stateBefore, startedByInvocation: true, launchMode: lease.launchMode ?? null, cleanedUp: false },
        details: { reason: "unexpected_headless_start" },
      });
    }
    visibleLease = lease;
    startedHere = true;
  } else if (lease.launchMode === "visible") {
    warnings.push("attached_existing_visible_avd");
  } else if (lease.launchMode === "headless") {
    const stopped = await stopExactHeadlessProcess(options, deps, lease);
    if (!stopped.ok) {
      return reauthFailure({
        stage: "cleanup",
        code: "cleanup_failed",
        lifecycle: { stateBefore, startedByInvocation: false, launchMode: "headless", cleanedUp: false },
        details: { reason: stopped.reason },
      });
    }
    // I3: a spawn failure here has started nothing (startOwnedAvd terminates its own aborted
    // boot), so the lifecycle must not claim otherwise.
    try {
      visibleLease = await deps.startAvd({ ...avdLifecycleOptions(options), launchMode: "visible" });
    } catch (error) {
      return reauthFailure({
        stage: "cleanup",
        code: "cleanup_failed",
        lifecycle: { stateBefore, startedByInvocation: false, launchMode: "headless", cleanedUp: false },
        details: { reason: sanitizeCode(error?.code) },
      });
    }
    startedHere = true;
  } else {
    return reauthFailure({
      stage: "cleanup",
      code: "cleanup_failed",
      lifecycle: { stateBefore, startedByInvocation: false, launchMode: null, cleanedUp: false },
      details: { reason: "avd_launch_mode_unknown" },
    });
  }

  // I3: an unguarded ADB failure here escaped reauthJiHuanShe entirely -- withAvdDriveLock
  // releases the lock and rethrows WITHOUT terminating the AVD, so a VISIBLE emulator was left
  // orphaned while the printed result denied starting anything and pointed the operator at their
  // own command line. The failure is now classified, and whatever this invocation started is
  // either stopped under the still-held lock or named in the warnings.
  try {
    deps.launchLoginScreen(avdLifecycleOptions(options));
  } catch (error) {
    return await abortReauth(options, deps, {
      stateBefore, startedHere, visibleLease, warnings, reason: sanitizeCode(error?.code),
    });
  }
  const ready = await waitForReadyHome(options, deps);
  if (!ready) {
    // The owner may still be typing: never stop a visible emulator mid-login.
    if (startedHere) warnings.push("visible_avd_left_running");
    return reauthFailure({
      stage: "capture",
      code: "reauth_required",
      lifecycle: { stateBefore, startedByInvocation: startedHere, launchMode: "visible", cleanedUp: false },
      warnings,
      details: { reason: "home_state_not_ready" },
    });
  }

  let cleanedUp = false;
  if (startedHere) {
    // Still holding avd-drive: stop exactly the visible process this invocation started, so the
    // next refresh returns to headless operation. An adopted AVD is never touched.
    cleanedUp = await stopStartedVisibleLease(options, deps, visibleLease);
    if (!cleanedUp) warnings.push("visible_avd_left_running");
  }
  return okResult({
    operation: "reauth",
    lifecycle: { stateBefore, startedByInvocation: startedHere, launchMode: "visible", cleanedUp },
    warnings,
  });
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

function usage() {
  return `Usage:
  node tools/jihuanshe_refresh.mjs status [options]
  node tools/jihuanshe_refresh.mjs refresh tournaments --as-of DATE --window-days DAYS [options]
  node tools/jihuanshe_refresh.mjs refresh market [--as-of DATE] [options]
  node tools/jihuanshe_refresh.mjs refresh all --as-of DATE --window-days DAYS [options]
  node tools/jihuanshe_refresh.mjs reauth [options]

Options:
  --root DIR             repository root that holds data/sources (default: this checkout)
  --format-id ID         environment format id (default: ${DEFAULT_FORMAT_ID})
  --time-zone ZONE       IANA time zone (default: ${DEFAULT_TIME_ZONE})
  --mapping FILE         archetype/printing mapping (default: ${DEFAULT_MAPPING_RELATIVE})
  --parser-version ID    normalizer version recorded in every snapshot
  --max-scrolls N        capture-side tournament index scroll ceiling
  --retain-raw DIR       diagnostic only: keep the exact capture bytes (0700 dir, 0600 file)
  --refresh-lock-path P  refresh-publication lock file
  --avd-lock-path P      avd-drive lock file (must differ from the refresh lock)
  --login-timeout SEC    how long reauth waits for the authenticated home state
  --capture-timeout SEC  how long a capture child may run
  --adb PATH / --emulator PATH / --ps PATH
`;
}

function usageEnvelope(operation, error) {
  return {
    schemaVersion: REFRESH_SCHEMA_VERSION,
    source: REFRESH_SOURCE,
    // The requested command when it was recognisable at all, so an argument-boundary failure
    // still says WHICH command was refused; "status" is the inert fallback.
    operation: OPERATIONS.includes(operation) ? operation : "status",
    status: "error",
    stage: ARGUMENT_STAGE,
    code: ARGUMENT_CODE,
    lifecycle: { ...UNKNOWN_LIFECYCLE },
    published: { snapshotIds: [] },
    warnings: [],
    details: { reason: sanitizeCode(error?.code) },
  };
}

// I6: parse-time failures and OPERATION failures are different animals. The argument-boundary
// pair (`arguments` / `refresh_input_invalid`) is reserved for the former; an operation that
// throws gets a real stage and stable code, with the precise reason in `details.reason`. Every
// reachable refresh throw happens before the lock is taken (lock-path collision, an unreadable
// own process-start token, library-level input misuse), hence stage `lock`.
function operationFailureEnvelope(command, error) {
  const details = { reason: sanitizeCode(error?.code) };
  if (command === "refresh") {
    return errorResult({ operation: "refresh", stage: "lock", code: "lock_busy", details });
  }
  return errorResult({
    operation: command === "reauth" ? "reauth" : "status",
    stage: "cleanup",
    code: "cleanup_failed",
    details,
  });
}

async function main(cleanupStack) {
  const argv = process.argv.slice(2);
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    if (argv.length === 0) process.stderr.write(usage());
    return usageEnvelope(argv[0], error);
  }
  try {
    if (options.command === "status") return await statusJiHuanShe(options);
    if (options.command === "reauth") return await reauthJiHuanShe(options);
    return await refreshJiHuanShe({ ...options, cleanupStack });
  } catch (error) {
    return operationFailureEnvelope(options.command, error);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const cleanupStack = createCleanupStack();
  const uninstall = installTerminationHandlers(process, cleanupStack);
  main(cleanupStack)
    .then((result) => {
      const rendered = renderRefreshResult(result);
      process.stdout.write(rendered.text);
      process.exitCode = rendered.exitCode;
    })
    .catch((error) => {
      // Belt for anything renderRefreshResult itself could not absorb: still exactly one object.
      const rendered = renderRefreshResult(operationFailureEnvelope(undefined, error));
      process.stdout.write(rendered.text);
      process.exitCode = 1;
    })
    .finally(uninstall);
}
