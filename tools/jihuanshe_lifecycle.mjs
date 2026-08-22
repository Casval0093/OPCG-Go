#!/usr/bin/env node
/**
 * Exact-process AVD lifecycle for the owned JiHuanShe emulator (Task 8).
 *
 * This module owns ONLY process/AVD/lock lifecycle mechanics -- never UI scraping, never
 * tournament/market business logic. It is deliberately standalone (no import of
 * jihuanshe_capture.mjs or jihuanshe_reader.mjs) so it can be unit tested with fully injected
 * runners and carries no risk of a circular dependency; tools/jihuanshe_capture.mjs is the one
 * that depends on this module, never the reverse.
 *
 * Every process/ADB/emulator interaction is reached through an injectable runner on `options`:
 *   - options.listProcesses()        -> [{ pid, command }] for every host process (default: ps)
 *   - options.processStartTime(pid)  -> exact `lstart` string, or null if the pid is gone
 *   - options.runAdb(args)           -> { status, stdout, stderr } for `adb -s emulator-5554 ...`
 *   - options.spawnEmulator(args)    -> a child-process-like handle (pid, kill(), once('exit'))
 *   - options.signalProcess(pid, sig)-> wraps process.kill; returns boolean, never throws ESRCH
 *   - options.now()                  -> ISO timestamp (clock injection for createdAt)
 * Tests ALWAYS supply fakes for these. Production callers (tools/jihuanshe_capture.mjs) leave
 * them undefined and get the real spawnSync/spawn/process.kill-backed defaults below, resolved
 * through options.psPath / options.adbPath / options.emulatorPath (mirroring the existing
 * --adb/--emulator CLI flags, plus a new --ps).
 *
 * Exact-process matching (the safety invariant this whole module exists to enforce): a PID
 * alone is never trusted. Every recorded process identity is a `processStartToken`, the SHA-256
 * of that PID plus its exact, full `lstart` start-time string (see computeProcessStartToken).
 * PIDs get reused by the OS; (pid, lstart) pairs do not repeat for a process's lifetime. A host
 * emulator is only ever treated as "ours" when ALL FOUR of: the recomputed token, the `-avd
 * JiHuanShe_SC` argument, the `-port 5554` argument, and the ADB-reported AVD name agree (see
 * verifyLiveLease). Every signal-sending path rechecks this immediately before signaling, never
 * relying on a value read even one tick earlier.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const OWNED_AVD = "JiHuanShe_SC";
export const OWNED_SERIAL = "emulator-5554";
export const OWNED_PORT = 5554;
export const LOCK_KIND = "avd-drive";
const LOCK_SCHEMA_VERSION = 1;
const DEFAULT_LOCK_PATH = join(tmpdir(), "jihuanshe-avd-drive.lock");

const AVD_ARG_PATTERN = new RegExp(`(?:^|\\s)-avd\\s+${OWNED_AVD}(?:\\s|$)`, "u");
const PORT_ARG_PATTERN = new RegExp(`(?:^|\\s)-port\\s+${OWNED_PORT}(?:\\s|$)`, "u");
const HEADLESS_ARG_PATTERN = /(?:^|\s)-no-window(?:\s|$)/u;

export class LifecycleError extends Error {
  constructor(code, message = code, details = {}) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.name = "LifecycleError";
    this.code = code;
    this.details = details;
  }
}

export class ReauthRequiredError extends LifecycleError {
  constructor() {
    super("reauth_required", "JiHuanShe login has expired");
    this.name = "ReauthRequiredError";
  }
}

function fail(code, message, details) {
  throw new LifecycleError(code, message, details);
}

// ---------------------------------------------------------------------------------------
// Exact-process token
// ---------------------------------------------------------------------------------------

export function computeProcessStartToken(pid, lstart) {
  if (!Number.isInteger(pid) || pid <= 0) fail("lifecycle_invalid_pid", "pid must be a positive integer");
  if (typeof lstart !== "string" || lstart.length === 0) {
    fail("lifecycle_invalid_lstart", "lstart must be a non-empty string");
  }
  return createHash("sha256").update(`${pid}:${lstart}`).digest("hex");
}

function parseAdbAvdName(output) {
  const lines = String(output ?? "").split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => line && line !== "OK");
  return lines.length === 1 ? lines[0] : null;
}

// ---------------------------------------------------------------------------------------
// Real runners (production defaults) -- every one is overridable per-call via `options`.
// ---------------------------------------------------------------------------------------

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePs(explicit) {
  const candidates = [explicit, "/bin/ps", "/usr/bin/ps"].filter(Boolean);
  const ps = candidates.find(executable);
  if (!ps) fail("ps_not_found", "ps not found; pass --ps PATH");
  return ps;
}

function resolveAdb(explicit) {
  const candidates = [
    explicit,
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
  ].filter(Boolean);
  const adb = candidates.find(executable);
  if (!adb) fail("adb_not_found", "adb not found; pass --adb PATH or set ANDROID_SDK_ROOT");
  return adb;
}

function resolveEmulator(explicit) {
  const candidates = [
    explicit,
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "emulator", "emulator"),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "emulator", "emulator"),
    join(homedir(), "Library", "Android", "sdk", "emulator", "emulator"),
  ].filter(Boolean);
  const emulator = candidates.find(executable);
  if (!emulator) fail("emulator_not_found", "Android emulator not found; pass --emulator PATH");
  return emulator;
}

function runSync(executablePath, args, description) {
  const result = spawnSync(executablePath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20_000,
  });
  if (result.error) fail("lifecycle_process_failed", `${description}: ${result.error.message}`);
  return result;
}

function defaultListProcesses(options) {
  const ps = resolvePs(options.psPath);
  const result = runSync(ps, ["-axwwo", "pid=,command="], "cannot list host processes");
  if (result.status !== 0) return [];
  return String(result.stdout)
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
}

function defaultProcessStartTime(pid, options) {
  const ps = resolvePs(options.psPath);
  const result = runSync(ps, ["-p", String(pid), "-o", "lstart="], "cannot read process start time");
  if (result.status !== 0) return null;
  const lstart = result.stdout.replace(/\r?\n+$/u, "");
  return lstart.length > 0 ? lstart : null;
}

function defaultRunAdb(args, options) {
  const adb = resolveAdb(options.adbPath);
  return runSync(adb, ["-s", OWNED_SERIAL, ...args], "adb command failed");
}

function defaultSpawnEmulator(args, options) {
  return spawn(resolveEmulator(options.emulatorPath), args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? join(homedir(), "Library", "Android", "sdk"),
      ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME ?? join(homedir(), "Library", "Android", "avd"),
    },
  });
}

function defaultSignalProcess(pid, signal) {
  try {
    return process.kill(pid, signal);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function bindRunners(options) {
  return {
    listProcesses: () => (options.listProcesses ? options.listProcesses() : defaultListProcesses(options)),
    processStartTime: (pid) => (
      options.processStartTime ? options.processStartTime(pid) : defaultProcessStartTime(pid, options)
    ),
    runAdb: (args) => (options.runAdb ? options.runAdb(args) : defaultRunAdb(args, options)),
    spawnEmulator: (args) => (
      options.spawnEmulator ? options.spawnEmulator(args) : defaultSpawnEmulator(args, options)
    ),
    signalProcess: (pid, signal) => (
      options.signalProcess ? options.signalProcess(pid, signal) : defaultSignalProcess(pid, signal)
    ),
    now: () => (options.now ? options.now() : new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------------------
// Async wait helper. A LifecycleError (e.g. ReauthRequiredError, ambiguous/foreign detection)
// always propagates immediately rather than being retried into a generic timeout; any other
// error is treated as transient and retried until the deadline.
// ---------------------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitUntil(check, timeoutMs, description, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const result = await check();
      if (result !== undefined && result !== false && result !== null) return result;
    } catch (error) {
      if (error instanceof LifecycleError) throw error;
      lastError = error;
    }
    if (Date.now() < deadline) await delay(intervalMs);
  } while (Date.now() < deadline);
  const suffix = lastError ? `: ${lastError.message}` : "";
  fail("lifecycle_timeout", `${description} timed out${suffix}`);
  return undefined;
}

async function waitUntilQuiet(predicate, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return true;
    if (Date.now() < deadline) await delay(intervalMs);
  } while (Date.now() < deadline);
  return predicate();
}

// ---------------------------------------------------------------------------------------
// Host-process discovery and exact-identity verification
// ---------------------------------------------------------------------------------------

// Returns the single host process claiming port 5554, or null if none. Throws
// `ambiguous_host_processes` if more than one process claims the port, and `foreign_avd` if the
// one process claiming it is not running AVD JiHuanShe_SC -- both are fail-closed: this project
// never guesses which of several candidates is "ours," and never assumes a same-port process is
// ours just because the port matches.
function locateOwnedEmulatorProcess(runners) {
  const candidates = runners.listProcesses().filter((proc) => PORT_ARG_PATTERN.test(proc.command));
  if (candidates.length > 1) {
    fail("ambiguous_host_processes", `multiple host processes claim port ${OWNED_PORT}`, {
      pids: candidates.map((proc) => proc.pid),
    });
  }
  if (candidates.length === 0) return null;
  const [candidate] = candidates;
  if (!AVD_ARG_PATTERN.test(candidate.command)) {
    fail("foreign_avd", `the process on port ${OWNED_PORT} is not AVD ${OWNED_AVD}`, { pid: candidate.pid });
  }
  return candidate;
}

function ownerAlive(owner, runners) {
  const lstart = runners.processStartTime(owner.pid);
  if (lstart === null) return false;
  return computeProcessStartToken(owner.pid, lstart) === owner.processStartToken;
}

// The four-way corroboration required before this module will ever signal a process: the
// recomputed token, the -avd/-port arguments, AND the ADB-reported AVD name must all agree.
function verifyLiveLease(lease, runners) {
  const lstart = runners.processStartTime(lease.pid);
  if (lstart === null) return false;
  if (computeProcessStartToken(lease.pid, lstart) !== lease.processStartToken) return false;

  const candidate = locateOwnedEmulatorProcess(runners);
  if (!candidate || candidate.pid !== lease.pid) return false;

  let adbResult;
  try {
    adbResult = runners.runAdb(["emu", "avd", "name"]);
  } catch {
    return false;
  }
  if (!adbResult || adbResult.status !== 0) return false;
  return parseAdbAvdName(adbResult.stdout) === OWNED_AVD;
}

// ---------------------------------------------------------------------------------------
// inspectOwnedAvd: read-only. Never starts, stops, or signals anything.
// ---------------------------------------------------------------------------------------

export function inspectOwnedAvd(options = {}) {
  const runners = bindRunners(options);
  const candidate = locateOwnedEmulatorProcess(runners);
  if (!candidate) return { state: "offline" };

  const lstart = runners.processStartTime(candidate.pid);
  if (lstart === null) return { state: "offline" };

  const adbResult = runners.runAdb(["emu", "avd", "name"]);
  if (adbResult.status !== 0 || parseAdbAvdName(adbResult.stdout) !== OWNED_AVD) {
    fail("foreign_avd", "ADB-reported AVD name does not match the owned AVD", {
      adbName: parseAdbAvdName(adbResult.stdout),
    });
  }

  const launchMode = HEADLESS_ARG_PATTERN.test(candidate.command) ? "headless" : "visible";
  return {
    state: `${launchMode}-existing`,
    lease: {
      avd: OWNED_AVD,
      serial: OWNED_SERIAL,
      pid: candidate.pid,
      processStartToken: computeProcessStartToken(candidate.pid, lstart),
      launchMode,
      startedByInvocation: false,
    },
  };
}

// ---------------------------------------------------------------------------------------
// startOwnedAvd: ensure-running. Adopts a pre-existing headless OR visible AVD read-only
// (never restarts/signals it); otherwise spawns a new one (headless by default; pass
// options.launchMode = "visible" to opt into a windowed spawn for debugging).
// ---------------------------------------------------------------------------------------

function buildOwnedEmulatorArgs(launchMode) {
  const args = [
    "-avd", OWNED_AVD,
    "-port", String(OWNED_PORT),
    "-no-audio",
    "-no-boot-anim",
    "-no-metrics",
    "-camera-back", "none",
    "-camera-front", "none",
    "-gpu", "auto",
    "-no-snapshot",
  ];
  if (launchMode !== "visible") args.splice(4, 0, "-no-window");
  return args;
}

// F1 (CRITICAL, fix round 1): a spawned pid is NOT a safe signal target on its own -- if the
// process we spawned exits before we get around to signaling it, the OS is free to hand that
// same PID number to a totally unrelated process, and a bare `signalProcess(pid, ...)` would hit
// THAT process instead. `spawnToken` is captured ONCE, immediately after spawnEmulator returns
// (before any wait), and every signal below is gated on a FRESH recheck against it -- the same
// "recompute the token, compare, only then signal" discipline verifyLiveLease already applies to
// cleanupOwnedLease, now applied here too. `child` is a belt-and-braces second check: real
// Node ChildProcess objects set `exitCode`/`signalCode` to non-null the instant the process
// exits, which is cheaper than a ps call when available -- but it is purely additive (a fake
// test double that doesn't expose these fields is not required to, and the ps-based token
// recheck is the mechanism that is actually enforced either way).
function verifyStillSpawnedProcess(pid, spawnToken, runners, child) {
  if (spawnToken === null) return false;
  if (child && (typeof child.exitCode === "number" || typeof child.signalCode === "string")) {
    return false;
  }
  const lstart = runners.processStartTime(pid);
  if (lstart === null) return false;
  return computeProcessStartToken(pid, lstart) === spawnToken;
}

// Signals a process this invocation itself just spawned, escalating from SIGTERM to SIGKILL --
// but ONLY while verifyStillSpawnedProcess keeps confirming it is still the SAME process. Shared
// by startOwnedAvd's aborted-boot path and its boot-window signal handler below.
async function terminateJustSpawnedProcess(pid, spawnToken, runners, options, child) {
  const graceMs = options.terminateGraceMs ?? 5_000;
  const forceMs = options.terminateForceMs ?? 1_000;
  const pollMs = options.terminatePollMs ?? 250;
  if (!verifyStillSpawnedProcess(pid, spawnToken, runners, child)) return;
  runners.signalProcess(pid, "SIGTERM");
  const died = await waitUntilQuiet(() => !verifyStillSpawnedProcess(pid, spawnToken, runners, child), graceMs, pollMs);
  if (died) return;
  if (!verifyStillSpawnedProcess(pid, spawnToken, runners, child)) return;
  runners.signalProcess(pid, "SIGKILL");
  await waitUntilQuiet(() => !verifyStillSpawnedProcess(pid, spawnToken, runners, child), forceMs, pollMs);
}

export async function startOwnedAvd(options = {}) {
  const runners = bindRunners(options);
  const existing = locateOwnedEmulatorProcess(runners);
  if (existing) {
    const lstart = runners.processStartTime(existing.pid);
    if (lstart === null) fail("avd_process_vanished", "owned AVD process disappeared during inspection");
    const adbResult = runners.runAdb(["emu", "avd", "name"]);
    if (adbResult.status !== 0 || parseAdbAvdName(adbResult.stdout) !== OWNED_AVD) {
      fail("foreign_avd", "ADB-reported AVD name does not match the owned AVD", {
        adbName: parseAdbAvdName(adbResult.stdout),
      });
    }
    return {
      avd: OWNED_AVD,
      serial: OWNED_SERIAL,
      pid: existing.pid,
      processStartToken: computeProcessStartToken(existing.pid, lstart),
      launchMode: HEADLESS_ARG_PATTERN.test(existing.command) ? "headless" : "visible",
      startedByInvocation: false,
    };
  }

  const launchMode = options.launchMode === "visible" ? "visible" : "headless";
  const args = buildOwnedEmulatorArgs(launchMode);
  const child = runners.spawnEmulator(args);
  if (typeof child?.unref === "function") child.unref();
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 0) fail("avd_spawn_failed", "emulator process did not report a pid");

  // F1: captured immediately, before any wait -- this is the ONLY thing that lets a later
  // signal (boot-abort or the aborted-boot cleanup below) tell "still the process I spawned"
  // apart from "the OS already recycled this PID." A null here means we could not even observe
  // the just-spawned process once; verifyStillSpawnedProcess then always refuses to signal.
  const spawnLstart = runners.processStartTime(pid);
  const spawnToken = spawnLstart === null ? null : computeProcessStartToken(pid, spawnLstart);

  const bootTimeoutMs = options.bootTimeoutMs ?? 180_000;
  const bootPollMs = options.bootPollMs ?? 250;

  // A signal arriving WHILE STILL BOOTING aborts the boot (best-effort, immediate SIGTERM, gated
  // on an immediate recheck against spawnToken); once boot succeeds this registration is removed
  // below, so a LATER signal (once the AVD is up and the callback is running) never touches it
  // here -- matching the pre-Task-8 behaviour where an invocation-started AVD survives its own
  // invocation once booted. withAvdDriveLock's own cleanupStartedOnFinish option is the only
  // thing that can still clean it up after that.
  let unregisterBootAbort = () => {};
  if (options.cleanupStack) {
    unregisterBootAbort = options.cleanupStack.add(() => {
      if (verifyStillSpawnedProcess(pid, spawnToken, runners, child)) {
        runners.signalProcess(pid, "SIGTERM");
      }
    });
  }

  try {
    await waitUntil(() => {
      const online = locateOwnedEmulatorProcess(runners);
      return online && online.pid === pid ? online : false;
    }, bootTimeoutMs, "owned AVD did not appear on the expected port", bootPollMs);

    const lstart = runners.processStartTime(pid);
    if (lstart === null) fail("avd_spawn_failed", "owned AVD process disappeared immediately after spawning");

    await waitUntil(() => {
      const result = runners.runAdb(["shell", "getprop", "sys.boot_completed"]);
      return result.status === 0 && result.stdout.trim() === "1";
    }, bootTimeoutMs, "owned AVD did not finish booting", bootPollMs);
    unregisterBootAbort();

    return {
      avd: OWNED_AVD,
      serial: OWNED_SERIAL,
      pid,
      processStartToken: computeProcessStartToken(pid, lstart),
      launchMode,
      startedByInvocation: true,
    };
  } catch (error) {
    unregisterBootAbort();
    await terminateJustSpawnedProcess(pid, spawnToken, runners, options, child);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------
// cleanupOwnedLease: SIGTERM then SIGKILL escalation, ONLY for a lease this invocation started,
// and ONLY after an immediate re-verification. Never signals a pre-existing (adopted) AVD.
// ---------------------------------------------------------------------------------------

export async function cleanupOwnedLease(lease, options = {}) {
  if (!lease || lease.startedByInvocation !== true) {
    return { cleaned: false, reason: "not_started_by_invocation" };
  }
  const runners = bindRunners(options);
  if (!verifyLiveLease(lease, runners)) {
    return { cleaned: false, reason: "lease_unverifiable" };
  }

  const graceMs = options.terminateGraceMs ?? 5_000;
  const forceMs = options.terminateForceMs ?? 1_000;
  const pollMs = options.terminatePollMs ?? 250;

  runners.signalProcess(lease.pid, "SIGTERM");
  const diedGracefully = await waitUntilQuiet(() => !verifyLiveLease(lease, runners), graceMs, pollMs);
  if (diedGracefully) return { cleaned: true, forced: false };

  if (!verifyLiveLease(lease, runners)) return { cleaned: true, forced: false };
  runners.signalProcess(lease.pid, "SIGKILL");
  await waitUntilQuiet(() => !verifyLiveLease(lease, runners), forceMs, pollMs);
  return { cleaned: true, forced: true };
}

// ---------------------------------------------------------------------------------------
// Lock file I/O
// ---------------------------------------------------------------------------------------

function readLock(lockPath) {
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    fail("avd_lock_corrupt", `lock file is not valid JSON: ${lockPath}`);
  }
  if (metadata?.schemaVersion !== LOCK_SCHEMA_VERSION || metadata?.kind !== LOCK_KIND
      || !metadata.owner || !metadata.lease) {
    fail("avd_lock_corrupt", `lock file has an unexpected shape: ${lockPath}`);
  }
  return metadata;
}

function tryCreateLockExclusive(path, metadata) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, `${JSON.stringify(metadata, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

function writeLockAtomicReplace(path, metadata) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

function releaseLockIfOwned(lockPath, ourPid) {
  let current;
  try {
    current = readLock(lockPath);
  } catch {
    return;
  }
  if (!current || current.owner?.pid !== ourPid) return;
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function ownerDescriptor(runners) {
  const lstart = runners.processStartTime(process.pid);
  if (lstart === null) fail("lifecycle_self_unverifiable", "cannot read this invocation's own process start time");
  return { pid: process.pid, processStartToken: computeProcessStartToken(process.pid, lstart) };
}

// ---------------------------------------------------------------------------------------
// recoverAbandonedCapture: the ONLY path allowed to clean up a lease left behind by a dead
// owner. Guarded by a SECOND mutex file (`${lockPath}.recovery`) so that when two callers race
// to recover the same stale lock, the loser performs a hard no-op -- not merely "no cleanup
// attempted," but zero reads of the main lock's contents beyond the initial stale check, and
// zero calls into signalProcess. See the module header for the four-way verification this relies
// on via verifyLiveLease.
//
// OPERATOR NOTE -- the ORPHANED RECOVERY MUTEX (F12, documented, staleness handling deferred).
// The `finally` below removes `${lockPath}.recovery` on every normal and error return, so the only
// way to orphan it is a hard kill of this process (SIGKILL, an OOM kill, a power loss) between the
// `wx` create and that `finally`. There is deliberately NO staleness/age handling: the mutex is
// bare and carries no liveness proof of its own, so an automatic reclaim would be a guess.
//
// The consequence is a PERMANENT DEADLOCK with a misleading message. Every later recovery attempt
// loses the `wx` race and fails `avd_recovery_lost_race` -- "another caller is already recovering
// this lock" -- which points the operator at a concurrent process that does not exist. The ONLY
// exit is to delete the file by hand:
//
//     rm /tmp/jihuanshe-avd-drive.lock.recovery      # or `${--avd-lock-path}.recovery`
//
// Recognise it by `avd_recovery_lost_race` repeating across separate, serial invocations when no
// other capture is running. A genuine race resolves on the next attempt; this one never does.
// Documented for operators in docs/jihuanshe-reader.md as well.
// ---------------------------------------------------------------------------------------

export async function recoverAbandonedCapture(metadata, options = {}) {
  const runners = bindRunners(options);
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const recoveryMutexPath = `${lockPath}.recovery`;

  if (ownerAlive(metadata.owner, runners)) {
    fail("avd_lock_held", "lock owner is alive; nothing to recover", { pid: metadata.owner.pid });
  }

  const wonRace = tryCreateLockExclusive(recoveryMutexPath, {
    recoveredBy: process.pid,
    at: runners.now(),
  });
  if (!wonRace) {
    fail("avd_recovery_lost_race", "another caller is already recovering this lock");
  }

  try {
    const current = readLock(lockPath);
    if (!current) return { recovered: true, leaseCleanup: { cleaned: false, reason: "lock_already_gone" } };
    if (ownerAlive(current.owner, runners)) {
      // A legitimate new owner appeared between our stale-check and winning the recovery mutex;
      // nothing is actually stale any more. Leave the (now-live) lock completely untouched.
      return { recovered: false, leaseCleanup: { cleaned: false, reason: "owner_no_longer_stale" } };
    }

    const lease = current.lease;
    if (!lease || lease.startedByInvocation !== true) {
      // Nothing this tool ever started -- never signal it. The lock itself is meaningless
      // garbage now (its owner is dead), so it is safe to remove while we hold the recovery
      // mutex, but the pre-existing AVD process, if any, is left completely untouched.
      unlinkSyncIfPresent(lockPath);
      return { recovered: true, leaseCleanup: { cleaned: false, reason: "not_started_by_invocation" } };
    }

    if (!verifyLiveLease(lease, runners)) {
      // Refuse outright: leave BOTH the stale lock file and the unverifiable process untouched,
      // so a confused operator gets a loud, actionable failure instead of the tool silently
      // guessing it is safe to proceed around an orphan it cannot positively identify.
      fail("lease_recovery_refused", "recorded lease no longer verifies against the live process", {
        pid: lease.pid,
      });
    }

    const cleanup = await cleanupOwnedLease(lease, options);
    unlinkSyncIfPresent(lockPath);
    return { recovered: true, leaseCleanup: cleanup };
  } finally {
    unlinkSyncIfPresent(recoveryMutexPath);
  }
}

function unlinkSyncIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// jihuanshe_reader.mjs's createCleanupStack().run() is SYNCHRONOUS by contract (it never awaits
// a cleanup entry's return value; see installTerminationHandlers, which re-signals this very
// process from inside the same synchronous handler). A signal-triggered cleanup therefore gets
// no time budget for cleanupOwnedLease's graceful-wait-then-SIGKILL-escalate dance -- it gets one
// synchronous, best-effort SIGTERM, exactly like the pre-Task-8 code's own signal-path cleanup
// (jihuanshe_capture.mjs's `ensureEmulator`, before this module existed, registered exactly this
// shape: recheck, then a single non-blocking kill()). Ambiguous/foreign detection is swallowed
// here (never thrown) because a signal handler is not the place to surface a fresh diagnostic;
// silently skipping the signal is the fail-closed choice when identity cannot be verified.
function synchronousBestEffortTerminate(lease, runners) {
  if (!lease || lease.startedByInvocation !== true) return;
  try {
    if (!verifyLiveLease(lease, runners)) return;
  } catch {
    return;
  }
  runners.signalProcess(lease.pid, "SIGTERM");
}

// ---------------------------------------------------------------------------------------
// withAvdDriveLock: the single entry point that ties acquisition (fresh or recovered),
// AVD ensure-running, the callback, and lock release together.
//
// options.cleanupStartedOnFinish (default false) governs whether an invocation-started AVD is
// torn down once the callback finishes: DEFAULT FALSE matches the pre-Task-8 behaviour, where a
// booted AVD survives its own invocation (success, error, OR a mid-callback signal) so the next
// command does not pay a fresh multi-minute boot -- only startOwnedAvd's OWN boot-window signal
// handler ever aborts a still-BOOTING spawn. Passing true (the CLI's --cleanup-started) makes
// BOTH the normal-finish path (full graceful SIGTERM-then-SIGKILL, awaited) and a mid-callback
// signal (best-effort synchronous SIGTERM only, since createCleanupStack().run() never awaits)
// attempt cleanup. The coordination LOCK ITSELF is always released either way, so a declined
// cleanup never blocks a later invocation.
// ---------------------------------------------------------------------------------------

export async function withAvdDriveLock(options, callback) {
  const runners = bindRunners(options);
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const cleanupStartedOnFinish = options.cleanupStartedOnFinish === true;

  const existing = readLock(lockPath);
  if (existing) {
    if (ownerAlive(existing.owner, runners)) {
      fail("avd_lock_held", "another JiHuanShe capture invocation is already running", {
        pid: existing.owner.pid,
      });
    }
    await recoverAbandonedCapture(existing, { ...options, lockPath });
  }

  const lease = await startOwnedAvd(options);
  const metadata = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    kind: LOCK_KIND,
    owner: ownerDescriptor(runners),
    createdAt: runners.now(),
    lease,
  };
  if (!tryCreateLockExclusive(lockPath, metadata)) {
    fail("avd_lock_held", "another JiHuanShe capture invocation acquired the lock first");
  }

  // F4 (fix round 1): the coordination LOCK must be released on a signal regardless of
  // --cleanup-started -- otherwise a SIGINT/SIGTERM during a default (non-cleanup-started)
  // capture leaks the lock file forever, since the process is about to die and the normal
  // post-callback release below never runs. Only the AVD-TERMINATION half stays gated on
  // cleanupStartedOnFinish; releasing the lock is unconditional whenever a cleanupStack exists.
  let unregister = () => {};
  if (options.cleanupStack) {
    unregister = options.cleanupStack.add(() => {
      if (cleanupStartedOnFinish) synchronousBestEffortTerminate(lease, runners);
      releaseLockIfOwned(lockPath, metadata.owner.pid);
    });
  }

  let result;
  let callbackError;
  try {
    result = await callback(lease);
  } catch (error) {
    callbackError = error;
  }

  let cleanupError;
  try {
    unregister();
    if (cleanupStartedOnFinish) await cleanupOwnedLease(lease, options);
    releaseLockIfOwned(lockPath, metadata.owner.pid);
  } catch (error) {
    cleanupError = error;
  }

  if (callbackError) throw callbackError;
  // A cleanup-only failure must NEVER turn an already-successful capture into an overall
  // failure: the caller's contract (see tools/jihuanshe_capture.mjs) is "exactly one sanitized
  // CaptureResult JSON object on stdout for success and failure" -- the successful result has
  // ALREADY been printed by the callback at this point, so rejecting here would print a SECOND,
  // contradictory failure envelope on top of it. Surface the cleanup error as a diagnostic
  // (never silently dropped) without failing the overall call.
  if (cleanupError) {
    const report = options.onCleanupError ?? ((error) => {
      process.stderr.write(`jihuanshe_capture: post-capture cleanup failed: ${error.message}\n`);
    });
    report(cleanupError);
  }
  return result;
}

// Exposed for tests that need to assert the exact lock-file shape/path without going through a
// full acquisition (e.g. seeding a stale lock fixture).
export function lockPathDefault() {
  return DEFAULT_LOCK_PATH;
}

export function writeLockForTest(lockPath, metadata) {
  writeLockAtomicReplace(lockPath, metadata);
}

export function readLockForTest(lockPath) {
  return readLock(lockPath);
}

// ---------------------------------------------------------------------------------------
// reauthOwnedAvd: polls an injected, app-specific home-state probe until it reports "ready",
// throws ReauthRequiredError on "reauth_required", or times out. This module has no opinion on
// HOW the caller launches the app or classifies its UI -- that stays with jihuanshe_capture.mjs,
// which owns the JiHuanShe-specific DOM/UIAutomator knowledge.
// ---------------------------------------------------------------------------------------

// options.pollHomeState() returns { state, value }: state is "ready" | "reauth_required" |
// "unknown"; value is whatever payload the caller wants back once ready (e.g. a UI dump). value
// must be truthy when state is "ready" -- this shares waitUntil's generic "falsy means keep
// polling" sentinel, so a ready state with a falsy value would be misread as not-yet-ready.
export async function reauthOwnedAvd(options = {}) {
  if (typeof options.pollHomeState !== "function") {
    fail("reauth_dependency_missing", "reauthOwnedAvd requires options.pollHomeState");
  }
  const timeoutMs = options.homeTimeoutMs ?? 45_000;
  const pollMs = options.homePollMs ?? 500;
  return waitUntil(async () => {
    const outcome = await options.pollHomeState();
    if (outcome.state === "reauth_required") throw new ReauthRequiredError();
    return outcome.state === "ready" ? outcome.value : false;
  }, timeoutMs, "JiHuanShe home screen", pollMs);
}
