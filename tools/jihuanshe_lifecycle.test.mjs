import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCleanupStack } from "./jihuanshe_reader.mjs";
import {
  LifecycleError,
  OWNED_AVD,
  OWNED_PORT,
  OWNED_SERIAL,
  ReauthRequiredError,
  cleanupOwnedLease,
  computeProcessStartToken,
  inspectOwnedAvd,
  reauthOwnedAvd,
  readLockForTest,
  recoverAbandonedCapture,
  startOwnedAvd,
  withAvdDriveLock,
  writeLockForTest,
} from "./jihuanshe_lifecycle.mjs";

const SELF_LSTART = "test-harness-self-start";
const SELF_TOKEN = computeProcessStartToken(process.pid, SELF_LSTART);

let workDir;
test.beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "jihuanshe-lifecycle-test-"));
});
test.afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function lockPath() {
  return join(workDir, "avd-drive.lock");
}

function emulatorCommand({ avd = OWNED_AVD, port = OWNED_PORT, headless = true } = {}) {
  return `/opt/android/emulator/emulator -avd ${avd} -port ${port}${headless ? " -no-window" : ""} -no-audio -no-boot-anim`;
}

function codeOf(error) {
  return error instanceof LifecycleError ? error.code : undefined;
}

// Builds a small mutable "world": a table of pid -> {command, lstart, alive}, wired into the
// options shape jihuanshe_lifecycle.mjs expects. Every process/ADB/emulator/signal interaction
// is satisfied here in-memory; nothing touches a real ps/adb/emulator binary or a real OS signal.
function makeWorld(overrides = {}) {
  const processes = new Map();
  const signals = [];
  const adbCalls = [];
  const spawnArgs = [];
  let nextPid = 40000;
  let adbBootReady = overrides.adbBootReady ?? true;
  let adbOnline = overrides.adbOnline ?? true;

  processes.set(process.pid, { command: "test-harness (self)", lstart: SELF_LSTART, alive: true });

  function addProcess(pid, fields) {
    processes.set(pid, { alive: true, ...fields });
  }

  const options = {
    lockPath: lockPath(),
    bootTimeoutMs: overrides.bootTimeoutMs ?? 200,
    bootPollMs: overrides.bootPollMs ?? 5,
    terminateGraceMs: overrides.terminateGraceMs ?? 50,
    terminateForceMs: overrides.terminateForceMs ?? 20,
    terminatePollMs: overrides.terminatePollMs ?? 5,
    listProcesses: () => [...processes.entries()]
      .filter(([, p]) => p.alive)
      .map(([pid, p]) => ({ pid, command: p.command })),
    processStartTime: (pid) => {
      const p = processes.get(pid);
      return p && p.alive ? p.lstart : null;
    },
    runAdb: (args) => {
      adbCalls.push(args);
      if (args[0] === "emu") {
        if (!adbOnline) return { status: 1, stdout: "", stderr: "no device" };
        const owned = [...processes.values()]
          .find((p) => p.alive && p.command.includes(`-port ${OWNED_PORT}`) && p.command.includes(`-avd ${OWNED_AVD}`));
        if (!owned) return { status: 1, stdout: "", stderr: "" };
        // S1: independently controllable from the process-table match, so a test can prove the
        // ADB-name leg is enforced on its OWN -- token, -avd, and -port can all agree while ADB
        // still disagrees (e.g. a stale/wrong device selected by -s, or a genuinely different
        // AVD answering on the forwarded serial).
        return { status: 0, stdout: `${overrides.adbReportedName ?? OWNED_AVD}\nOK\n`, stderr: "" };
      }
      if (args[0] === "shell") {
        const owned = [...processes.values()]
          .find((p) => p.alive && p.command.includes(`-port ${OWNED_PORT}`) && p.command.includes(`-avd ${OWNED_AVD}`));
        if (!owned) return { status: 1, stdout: "", stderr: "device offline" };
        return { status: 0, stdout: adbBootReady ? "1\n" : "0\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    signalProcess: (pid, signal) => {
      signals.push({ pid, signal });
      const p = processes.get(pid);
      if (p && (overrides.diesOn ?? ["SIGTERM", "SIGKILL"]).includes(signal)) p.alive = false;
      return true;
    },
    spawnEmulator: (args) => {
      const pid = nextPid;
      nextPid += 1;
      spawnArgs.push(args);
      // `args` is whatever buildOwnedEmulatorArgs() (production code) actually built, so it
      // already contains "-avd JiHuanShe_SC -port 5554" and conditionally "-no-window" --
      // reusing it verbatim keeps this fake's command string authentic.
      addProcess(pid, { command: `/fake/emulator ${args.join(" ")}`, lstart: `spawned-${pid}-start` });
      return { pid, unref() {} };
    },
    now: () => "2026-08-20T12:00:00Z",
  };

  return { options, processes, signals, adbCalls, spawnArgs, addProcess };
}

// ---------------------------------------------------------------------------------------
// computeProcessStartToken
// ---------------------------------------------------------------------------------------

test("computeProcessStartToken is deterministic and PID-reuse sensitive", () => {
  const tokenA = computeProcessStartToken(4242, "Wed Aug 20 12:00:00 2026");
  const tokenB = computeProcessStartToken(4242, "Wed Aug 20 12:00:00 2026");
  const reused = computeProcessStartToken(4242, "Thu Aug 21 09:00:00 2026");
  assert.equal(tokenA, tokenB);
  assert.notEqual(tokenA, reused);
  assert.throws(() => computeProcessStartToken(0, "x"), /lifecycle_invalid_pid/);
  assert.throws(() => computeProcessStartToken(4242, ""), /lifecycle_invalid_lstart/);
});

// ---------------------------------------------------------------------------------------
// inspectOwnedAvd: read-only, all five states reachable via inspect+start
// ---------------------------------------------------------------------------------------

test("inspectOwnedAvd reports offline when nothing claims the owned port", () => {
  const { options } = makeWorld();
  assert.deepEqual(inspectOwnedAvd(options), { state: "offline" });
});

test("inspectOwnedAvd reports headless-existing and visible-existing without starting or signaling", () => {
  const headless = makeWorld();
  headless.addProcess(777, { command: emulatorCommand({ headless: true }), lstart: "headless-start" });
  const headlessResult = inspectOwnedAvd(headless.options);
  assert.equal(headlessResult.state, "headless-existing");
  assert.equal(headlessResult.lease.startedByInvocation, false);
  assert.equal(headless.signals.length, 0);
  assert.equal(headless.spawnArgs.length, 0);

  const visible = makeWorld();
  visible.addProcess(778, { command: emulatorCommand({ headless: false }), lstart: "visible-start" });
  const visibleResult = inspectOwnedAvd(visible.options);
  assert.equal(visibleResult.state, "visible-existing");
  assert.equal(visibleResult.lease.launchMode, "visible");
  assert.equal(visible.signals.length, 0);
});

test("inspectOwnedAvd fails closed on ambiguous host processes and never signals either one", () => {
  const world = makeWorld();
  world.addProcess(801, { command: emulatorCommand(), lstart: "a" });
  world.addProcess(802, { command: emulatorCommand(), lstart: "b" });
  assert.throws(() => inspectOwnedAvd(world.options), (error) => codeOf(error) === "ambiguous_host_processes");
  assert.equal(world.signals.length, 0);
});

test("inspectOwnedAvd fails closed on a foreign AVD name in the process arguments", () => {
  const world = makeWorld();
  world.addProcess(803, { command: emulatorCommand({ avd: "Another_AVD" }), lstart: "c" });
  assert.throws(() => inspectOwnedAvd(world.options), (error) => codeOf(error) === "foreign_avd");
  assert.equal(world.signals.length, 0);
});

test("inspectOwnedAvd fails closed when ADB-reported AVD name disagrees with the process arguments", () => {
  const world = makeWorld({ adbOnline: false });
  world.addProcess(804, { command: emulatorCommand(), lstart: "d" });
  assert.throws(() => inspectOwnedAvd(world.options), (error) => codeOf(error) === "foreign_avd");
  assert.equal(world.signals.length, 0);
});

// ---------------------------------------------------------------------------------------
// startOwnedAvd
// ---------------------------------------------------------------------------------------

test("startOwnedAvd adopts a pre-existing headless AVD read-only (never signals it)", async () => {
  const world = makeWorld();
  world.addProcess(901, { command: emulatorCommand({ headless: true }), lstart: "existing-start" });
  const lease = await startOwnedAvd(world.options);
  assert.deepEqual(lease, {
    avd: OWNED_AVD,
    serial: OWNED_SERIAL,
    pid: 901,
    processStartToken: computeProcessStartToken(901, "existing-start"),
    launchMode: "headless",
    startedByInvocation: false,
  });
  assert.equal(world.signals.length, 0);
  assert.equal(world.spawnArgs.length, 0);
});

test("startOwnedAvd adopts a pre-existing visible AVD read-only", async () => {
  const world = makeWorld();
  world.addProcess(902, { command: emulatorCommand({ headless: false }), lstart: "visible-start" });
  const lease = await startOwnedAvd(world.options);
  assert.equal(lease.launchMode, "visible");
  assert.equal(lease.startedByInvocation, false);
  assert.equal(world.signals.length, 0);
});

test("startOwnedAvd spawns headless-by-default when offline (headless-started)", async () => {
  const world = makeWorld();
  const lease = await startOwnedAvd(world.options);
  assert.equal(lease.startedByInvocation, true);
  assert.equal(lease.launchMode, "headless");
  assert.equal(world.spawnArgs.length, 1);
  assert.ok(world.spawnArgs[0].includes("-no-window"));
  for (const forbidden of ["-wipe-data", "-read-only", "-no-snapshot-save"]) {
    assert.equal(world.spawnArgs[0].includes(forbidden), false);
  }
});

test("startOwnedAvd can spawn visible (visible-started) when explicitly requested", async () => {
  const world = makeWorld();
  const lease = await startOwnedAvd({ ...world.options, launchMode: "visible" });
  assert.equal(lease.startedByInvocation, true);
  assert.equal(lease.launchMode, "visible");
  assert.equal(world.spawnArgs[0].includes("-no-window"), false);
});

test("startOwnedAvd times out (not silently succeeds) when boot never completes", async () => {
  const world = makeWorld({ adbBootReady: false, bootTimeoutMs: 30, bootPollMs: 5 });
  await assert.rejects(
    startOwnedAvd(world.options),
    (error) => codeOf(error) === "lifecycle_timeout",
  );
});

test("startOwnedAvd fails closed on a foreign pre-existing AVD instead of adopting or restarting it", async () => {
  const world = makeWorld({ adbOnline: false });
  world.addProcess(903, { command: emulatorCommand(), lstart: "e" });
  await assert.rejects(startOwnedAvd(world.options), (error) => codeOf(error) === "foreign_avd");
  assert.equal(world.signals.length, 0);
  assert.equal(world.spawnArgs.length, 0);
});

test("startOwnedAvd aborts a still-booting spawn on a signal, then leaves the registration removed", async () => {
  const world = makeWorld({ adbBootReady: false, bootTimeoutMs: 150, bootPollMs: 5 });
  const stack = createCleanupStack();
  const startPromise = startOwnedAvd({ ...world.options, cleanupStack: stack });
  // Give startOwnedAvd a tick to spawn and register its boot-abort handler, then fire a signal
  // as if SIGINT/SIGTERM arrived mid-boot (boot never completes in this world).
  await new Promise((resolve) => { setTimeout(resolve, 15); });
  stack.run();
  assert.deepEqual(world.signals, [{ pid: 40000, signal: "SIGTERM" }]);
  assert.equal(world.processes.get(40000)?.alive, false, "the aborted boot's process must actually die");
  // The still-pending startOwnedAvd call now fails because boot never completed.
  await assert.rejects(startPromise);
});

test("startOwnedAvd's boot-abort handler is unregistered once boot succeeds (a later signal does nothing here)", async () => {
  const world = makeWorld();
  const stack = createCleanupStack();
  const lease = await startOwnedAvd({ ...world.options, cleanupStack: stack });
  assert.equal(lease.startedByInvocation, true);
  stack.run(); // simulates a signal arriving AFTER the AVD is already up
  assert.equal(world.signals.length, 0, "once booted, this module's own boot-window handler must not fire");
});

// F1 (CRITICAL, fix round 1): a spawned pid is recycled for an unrelated process before this
// module gets around to signaling it -- both signal-issuing sites (the boot-abort handler and
// the aborted-boot catch-block termination) must refuse to signal, not just "eventually" but on
// every single recheck. The pre-fix code signaled the bare pid unconditionally in both places.

test("F1: the boot-abort signal handler sends ZERO signals when the pid was recycled before the signal arrives", async () => {
  const world = makeWorld({ adbBootReady: false, bootTimeoutMs: 150, bootPollMs: 5 });
  const stack = createCleanupStack();
  const startPromise = startOwnedAvd({ ...world.options, cleanupStack: stack });
  // Give startOwnedAvd a tick to spawn and capture spawnToken, then simulate the OS recycling
  // pid 40000 for a totally unrelated process in the window before the signal arrives: same
  // pid, different lstart -- this must be indistinguishable from "a different process" to
  // verifyStillSpawnedProcess.
  await new Promise((resolve) => { setTimeout(resolve, 15); });
  world.addProcess(40000, { command: emulatorCommand(), lstart: "a-totally-different-process" });
  stack.run();
  assert.equal(world.signals.length, 0, "a recycled pid must never be signaled by the boot-abort handler");
  // The still-pending startOwnedAvd call now fails because boot never completed; its OWN
  // termination attempt (the catch block, tested separately below) must also refuse to signal.
  await assert.rejects(startPromise);
  assert.equal(world.signals.length, 0, "the catch-block termination attempt must also refuse to signal the recycled pid");
});

test("F1: terminateJustSpawnedProcess (the catch-block path) sends ZERO signals when the pid was recycled before the boot timeout fires", async () => {
  const world = makeWorld({ adbBootReady: false, bootTimeoutMs: 30, bootPollMs: 5 });
  const startPromise = startOwnedAvd(world.options); // no cleanupStack: exercises ONLY the catch-block path
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  world.addProcess(40000, { command: emulatorCommand(), lstart: "a-totally-different-process" });
  await assert.rejects(startPromise, (error) => codeOf(error) === "lifecycle_timeout");
  assert.deepEqual(world.signals, [], "a recycled pid must never be signaled, even via the boot-timeout termination path");
});

test("F1: verifyStillSpawnedProcess refuses to signal when the spawned process could never be observed even once", async () => {
  // spawnLstart is captured immediately after spawn; if that first read already comes back
  // null (the process could not be found even once), spawnToken is null and nothing may ever
  // be signaled for it -- there is no baseline to recheck against.
  const world = makeWorld({ bootTimeoutMs: 30, bootPollMs: 5 });
  world.options.processStartTime = () => null;
  await assert.rejects(startOwnedAvd(world.options));
  assert.deepEqual(world.signals, []);
});

// ---------------------------------------------------------------------------------------
// cleanupOwnedLease -- the core "no signal sent" proofs
// ---------------------------------------------------------------------------------------

function makeLease(overrides = {}) {
  return {
    avd: OWNED_AVD,
    serial: OWNED_SERIAL,
    pid: 5252,
    processStartToken: computeProcessStartToken(5252, "fixture-emulator-start"),
    launchMode: "headless",
    startedByInvocation: true,
    ...overrides,
  };
}

test("cleanupOwnedLease is a no-op and sends no signal for a lease this invocation did not start", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease({ startedByInvocation: false });
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: false, reason: "not_started_by_invocation" });
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease sends no signal when the PID has been reused by an unrelated process", async () => {
  const world = makeWorld();
  // Same pid, but a DIFFERENT lstart -- the OS reused 5252 for something else entirely.
  world.addProcess(5252, { command: emulatorCommand(), lstart: "a-totally-different-process" });
  const lease = makeLease();
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: false, reason: "lease_unverifiable" });
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease sends no signal when the recorded token no longer matches (mismatch)", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease({ processStartToken: "not-the-real-token" });
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: false, reason: "lease_unverifiable" });
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease sends no signal when the process is gone entirely", async () => {
  const world = makeWorld();
  const lease = makeLease();
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: false, reason: "lease_unverifiable" });
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease refuses (throws) rather than guessing when the port is foreign, and sends no signal", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand({ avd: "Another_AVD" }), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  await assert.rejects(cleanupOwnedLease(lease, world.options), (error) => codeOf(error) === "foreign_avd");
  assert.equal(world.signals.length, 0);
});

// S1 (mutation survivor, fix round 1): token, -avd, and -port can ALL agree while ADB itself
// still disagrees on the AVD name -- verifyLiveLease's four-way check must still refuse in that
// case. Dropping this leg (or the ADB call entirely) previously left the whole suite green.
test("S1: cleanupOwnedLease is unverifiable and sends no signal when ADB reports a different AVD name despite token/-avd/-port agreeing", async () => {
  const world = makeWorld({ adbReportedName: "Some_Other_AVD" });
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: false, reason: "lease_unverifiable" });
  assert.equal(world.signals.length, 0);
});

test("S1: recoverAbandonedCapture also refuses (lease_recovery_refused) when only the ADB-reported name disagrees", async () => {
  const world = makeWorld({ adbReportedName: "Some_Other_AVD" });
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);
  await assert.rejects(
    recoverAbandonedCapture(metadata, world.options),
    (error) => codeOf(error) === "lease_recovery_refused",
  );
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease refuses on ambiguous host processes and sends no signal", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  world.addProcess(5253, { command: emulatorCommand(), lstart: "other" });
  const lease = makeLease();
  await assert.rejects(cleanupOwnedLease(lease, world.options), (error) => codeOf(error) === "ambiguous_host_processes");
  assert.equal(world.signals.length, 0);
});

test("cleanupOwnedLease sends SIGTERM to a verified, invocation-started lease and confirms death", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: true, forced: false });
  assert.deepEqual(world.signals, [{ pid: 5252, signal: "SIGTERM" }]);
});

test("cleanupOwnedLease escalates to SIGKILL when SIGTERM does not end the process in time", async () => {
  const world = makeWorld({ diesOn: ["SIGKILL"] });
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const result = await cleanupOwnedLease(lease, world.options);
  assert.deepEqual(result, { cleaned: true, forced: true });
  assert.deepEqual(world.signals, [
    { pid: 5252, signal: "SIGTERM" },
    { pid: 5252, signal: "SIGKILL" },
  ]);
});

// ---------------------------------------------------------------------------------------
// recoverAbandonedCapture
// ---------------------------------------------------------------------------------------

function staleLockMetadata(lease, ownerOverrides = {}) {
  return {
    schemaVersion: 1,
    kind: "avd-drive",
    owner: { pid: 4242, processStartToken: computeProcessStartToken(4242, "fixture-owner-start"), ...ownerOverrides },
    createdAt: "2026-08-20T12:00:00Z",
    lease,
  };
}

test("recoverAbandonedCapture refuses when the recorded owner is actually still alive", async () => {
  const world = makeWorld();
  world.addProcess(4242, { command: "unrelated-but-still-alive", lstart: "fixture-owner-start" });
  const metadata = staleLockMetadata(makeLease());
  await assert.rejects(
    recoverAbandonedCapture(metadata, world.options),
    (error) => codeOf(error) === "avd_lock_held",
  );
  assert.equal(world.signals.length, 0);
});

test("recoverAbandonedCapture proceeds when the owner PID was merely reused (token mismatch = dead)", async () => {
  const world = makeWorld();
  // pid 4242 exists again, but belongs to something else now.
  world.addProcess(4242, { command: "unrelated-new-process", lstart: "a-completely-different-process" });
  const lease = makeLease({ startedByInvocation: false });
  writeLockForTest(lockPath(), staleLockMetadata(lease));
  const result = await recoverAbandonedCapture(staleLockMetadata(lease), world.options);
  assert.equal(result.recovered, true);
});

test("recoverAbandonedCapture removes the stale lock and touches nothing when the lease was never invocation-started", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease({ startedByInvocation: false });
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);

  const result = await recoverAbandonedCapture(metadata, world.options);
  assert.deepEqual(result, { recovered: true, leaseCleanup: { cleaned: false, reason: "not_started_by_invocation" } });
  assert.equal(world.signals.length, 0);
  assert.equal(readLockForTest(lockPath()), null);
});

test("recoverAbandonedCapture cleans a verified, invocation-started lease and removes the lock", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);

  const result = await recoverAbandonedCapture(metadata, world.options);
  assert.equal(result.recovered, true);
  assert.equal(result.leaseCleanup.cleaned, true);
  assert.deepEqual(world.signals, [{ pid: 5252, signal: "SIGTERM" }]);
  assert.equal(readLockForTest(lockPath()), null);
});

test("recoverAbandonedCapture with an unverifiable lease fails lease_recovery_refused, leaves the lock AND the process untouched", async () => {
  const world = makeWorld();
  // pid 5252 is alive, but its token no longer matches (as if it were reused / a different launch).
  world.addProcess(5252, { command: emulatorCommand(), lstart: "not-the-recorded-start-time" });
  const lease = makeLease();
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);

  await assert.rejects(
    recoverAbandonedCapture(metadata, world.options),
    (error) => codeOf(error) === "lease_recovery_refused",
  );
  assert.equal(world.signals.length, 0, "an unverifiable lease must never be signaled");
  assert.notEqual(readLockForTest(lockPath()), null, "the stale lock must be left in place, not silently cleared");
});

test("recoverAbandonedCapture with a gone lease process fails lease_recovery_refused without signaling anything", async () => {
  const world = makeWorld();
  // pid 5252 is not present at all.
  const lease = makeLease();
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);

  await assert.rejects(
    recoverAbandonedCapture(metadata, world.options),
    (error) => codeOf(error) === "lease_recovery_refused",
  );
  assert.equal(world.signals.length, 0);
  assert.notEqual(readLockForTest(lockPath()), null);
});

test("recoverAbandonedCapture: the loser of a concurrent recovery performs zero cleanup and sends zero signals", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  const lease = makeLease();
  const metadata = staleLockMetadata(lease);
  writeLockForTest(lockPath(), metadata);

  // Simulate a concurrent winner: pre-create the recovery mutex file the real function relies on.
  writeFileSync(`${lockPath()}.recovery`, "held-by-another-caller", { flag: "wx" });

  await assert.rejects(
    recoverAbandonedCapture(metadata, world.options),
    (error) => codeOf(error) === "avd_recovery_lost_race",
  );
  assert.equal(world.signals.length, 0, "the loser must never signal the leased process");
  assert.notEqual(readLockForTest(lockPath()), null, "the loser must never remove the lock");
  // Clean up the mutex we planted so afterEach's rmSync (recursive) is the only teardown needed;
  // this assertion just documents that the real function never touched it.
  assert.equal(readFileSync(`${lockPath()}.recovery`, "utf8"), "held-by-another-caller");
});

// ---------------------------------------------------------------------------------------
// withAvdDriveLock: acquisition, lock-file shape, ordering, and SIGINT/SIGTERM integration
// ---------------------------------------------------------------------------------------

test("withAvdDriveLock writes the exact lock metadata shape before invoking the callback", async () => {
  const world = makeWorld();
  let sawDuringCallback;
  await withAvdDriveLock(world.options, async (lease) => {
    sawDuringCallback = readLockForTest(lockPath());
    return lease;
  });
  assert.equal(sawDuringCallback.schemaVersion, 1);
  assert.equal(sawDuringCallback.kind, "avd-drive");
  assert.deepEqual(Object.keys(sawDuringCallback).sort(), ["createdAt", "kind", "lease", "owner", "schemaVersion"]);
  assert.deepEqual(Object.keys(sawDuringCallback.owner).sort(), ["pid", "processStartToken"]);
  assert.deepEqual(
    Object.keys(sawDuringCallback.lease).sort(),
    ["avd", "launchMode", "pid", "processStartToken", "serial", "startedByInvocation"],
  );
  assert.equal(sawDuringCallback.owner.pid, process.pid);
  assert.equal(sawDuringCallback.owner.processStartToken, SELF_TOKEN);
  assert.equal(sawDuringCallback.lease.avd, OWNED_AVD);
  assert.equal(sawDuringCallback.lease.serial, OWNED_SERIAL);
});

test("withAvdDriveLock releases the lock after a successful callback", async () => {
  const world = makeWorld();
  await withAvdDriveLock(world.options, async () => "ok");
  assert.equal(readLockForTest(lockPath()), null);
});

test("withAvdDriveLock holds exactly ONE lock across every item of a multi-event batch (one-lock-across-batch)", async () => {
  // tools/jihuanshe_capture.mjs's collect tournament-batch enumerates stable event identities and
  // captures every selected one INSIDE a single withAvdDriveLock callback (see
  // captureJiHuanShe/collectTournamentBatch) -- this proves the underlying lock-holding
  // guarantee that structure relies on: the SAME lock (same owner, same lease) must still be
  // held before and after each simulated per-event capture, never re-acquired or released
  // mid-batch, and released exactly once after the whole batch finishes.
  const world = makeWorld();
  const snapshotsPerEvent = [];
  await withAvdDriveLock(world.options, async () => {
    for (let eventIndex = 0; eventIndex < 3; eventIndex += 1) {
      snapshotsPerEvent.push(readLockForTest(lockPath()));
    }
  });
  assert.equal(snapshotsPerEvent.length, 3);
  const [first, ...rest] = snapshotsPerEvent;
  assert.ok(first, "the lock must already be held once the batch's per-event work begins");
  for (const snapshot of rest) assert.deepEqual(snapshot, first);
  assert.equal(readLockForTest(lockPath()), null, "released exactly once, after the whole batch");
});

test("withAvdDriveLock refuses to run the callback while another invocation genuinely holds the lock", async () => {
  const world = makeWorld();
  world.addProcess(process.pid, { command: "test-harness (self)", lstart: SELF_LSTART });
  writeLockForTest(lockPath(), {
    schemaVersion: 1,
    kind: "avd-drive",
    owner: { pid: process.pid, processStartToken: SELF_TOKEN },
    createdAt: "2026-08-20T12:00:00Z",
    lease: makeLease(),
  });
  let callbackRan = false;
  await assert.rejects(
    withAvdDriveLock(world.options, async () => { callbackRan = true; }),
    (error) => codeOf(error) === "avd_lock_held",
  );
  assert.equal(callbackRan, false);
});

test("withAvdDriveLock recovers a stale lock (dead owner, verified lease) and still completes the callback", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "fixture-emulator-start" });
  writeLockForTest(lockPath(), staleLockMetadata(makeLease()));

  const result = await withAvdDriveLock(world.options, async (lease) => lease.startedByInvocation);
  // The old (now-terminated) lease was invocation-started, so recovery signaled pid 5252; since
  // it dies on SIGTERM in this world, startOwnedAvd then found the port free and spawned a brand
  // new AVD (this world's first spawn, pid 40000) for this invocation. cleanupStartedOnFinish
  // defaults to false, so that fresh lease is left running -- only the recovery signal fires.
  assert.deepEqual(world.signals, [{ pid: 5252, signal: "SIGTERM" }]);
  assert.equal(result, true);
  assert.equal(readLockForTest(lockPath()), null);
});

test("withAvdDriveLock leaves an invocation-started AVD running by default (no --cleanup-started)", async () => {
  const world = makeWorld();
  await withAvdDriveLock(world.options, async (lease) => {
    assert.equal(lease.startedByInvocation, true);
  });
  assert.equal(world.signals.length, 0, "the default must never signal an AVD it just started");
  assert.equal(readLockForTest(lockPath()), null, "the coordination lock is still released either way");
  assert.equal(world.processes.get(40000)?.alive, true, "the freshly spawned AVD must still be running");
});

test("withAvdDriveLock propagates lease_recovery_refused and never invokes the callback", async () => {
  const world = makeWorld();
  world.addProcess(5252, { command: emulatorCommand(), lstart: "not-the-recorded-start-time" });
  writeLockForTest(lockPath(), staleLockMetadata(makeLease()));

  let callbackRan = false;
  await assert.rejects(
    withAvdDriveLock(world.options, async () => { callbackRan = true; }),
    (error) => codeOf(error) === "lease_recovery_refused",
  );
  assert.equal(callbackRan, false);
  assert.equal(world.signals.length, 0);
  assert.notEqual(readLockForTest(lockPath()), null);
});

test("withAvdDriveLock: with --cleanup-started, cleanup completes before the lock release event", async () => {
  const world = makeWorld();
  const order = [];
  const originalSignal = world.options.signalProcess;
  world.options.signalProcess = (pid, signal) => {
    order.push(`signal:${signal}`);
    order.push(`lock-still-present:${readLockForTest(lockPath()) !== null}`);
    return originalSignal(pid, signal);
  };

  await withAvdDriveLock({ ...world.options, cleanupStartedOnFinish: true }, async () => "ok");

  assert.deepEqual(order, ["signal:SIGTERM", "lock-still-present:true"]);
  assert.equal(readLockForTest(lockPath()), null);
});

test("withAvdDriveLock: with --cleanup-started, the callback's error wins even when cleanup also fails", async () => {
  const world = makeWorld();
  await assert.rejects(
    withAvdDriveLock({ ...world.options, cleanupStartedOnFinish: true }, async () => {
      // The lock is starting offline, so startOwnedAvd spawns a fresh, invocation-started lease
      // (pid 40000, this world's first spawn). Adding a second same-port process here makes the
      // POST-callback cleanup step itself throw ambiguous_host_processes -- proving the ORIGINAL
      // callback error still wins rather than being replaced by the cleanup-time failure.
      world.addProcess(50000, { command: emulatorCommand(), lstart: "rogue-start" });
      throw new Error("callback failed first");
    }),
    (error) => /callback failed first/.test(error.message),
  );
});

test("withAvdDriveLock: a cleanup-only failure after a SUCCESSFUL callback never turns the call into a failure", async () => {
  // The CLI's contract is exactly one CaptureResult JSON object on stdout for success AND
  // failure; a successful capture has already printed its result inside the callback by the
  // time cleanup runs, so a cleanup-time error must never reject the call (which would cause a
  // second, contradictory failure envelope to be printed on top of the first).
  const world = makeWorld();
  let reportedError;
  const result = await withAvdDriveLock({
    ...world.options,
    cleanupStartedOnFinish: true,
    onCleanupError: (error) => { reportedError = error; },
  }, async () => {
    world.addProcess(50000, { command: emulatorCommand(), lstart: "rogue-start" });
    return "captured-ok";
  });
  assert.equal(result, "captured-ok");
  assert.ok(reportedError, "the cleanup failure must still be reported, just not thrown");
  assert.equal(codeOf(reportedError), "ambiguous_host_processes");
});

// F4 (fix round 1): checked INSIDE the callback, immediately after the simulated signal, not
// only after the whole call resolves -- a real SIGINT/SIGTERM kills the process right after
// cleanupStack.run(), so the NORMAL post-callback release (which also unconditionally releases
// the lock) never gets a chance to run. Asserting only after resolution was the vacuous version
// of this test: it passed even when the signal path registered nothing at all, because the
// normal-completion path released the lock anyway once the (never-actually-killed) test callback
// returned.
test("F4: SIGINT/SIGTERM on a default (non-cleanup-started) capture releases the lock immediately, without stopping the AVD", async () => {
  const world = makeWorld();
  const stack = createCleanupStack();
  let lockStateRightAfterSignal;
  let signalsRightAfterSignal;

  await withAvdDriveLock({ ...world.options, cleanupStack: stack }, async () => {
    stack.run(); // simulate SIGINT/SIGTERM arriving mid-capture, default (no --cleanup-started)
    lockStateRightAfterSignal = readLockForTest(lockPath());
    signalsRightAfterSignal = [...world.signals];
  });

  assert.equal(lockStateRightAfterSignal, null, "the signal handler itself must release the lock, not just the normal completion path");
  assert.deepEqual(signalsRightAfterSignal, [], "a signal must not terminate the AVD unless --cleanup-started was requested");
  assert.equal(world.processes.get(40000)?.alive, true);
  assert.equal(readLockForTest(lockPath()), null, "still released after normal completion too (idempotent)");
});

test("F4: with --cleanup-started, SIGINT/SIGTERM still terminates the AVD (unchanged behavior)", async () => {
  const world = makeWorld();
  const stack = createCleanupStack();
  let lockStateRightAfterSignal;

  await withAvdDriveLock({ ...world.options, cleanupStack: stack, cleanupStartedOnFinish: true }, async () => {
    stack.run();
    lockStateRightAfterSignal = readLockForTest(lockPath());
  });

  assert.equal(lockStateRightAfterSignal, null);
  assert.deepEqual(world.signals, [{ pid: 40000, signal: "SIGTERM" }]);
});

test("withAvdDriveLock: with --cleanup-started, a mid-callback signal cleans and releases", async () => {
  const world = makeWorld();
  const stack = createCleanupStack();
  let sawLockDuringSignal;

  await withAvdDriveLock({ ...world.options, cleanupStack: stack, cleanupStartedOnFinish: true }, async () => {
    // Simulate a SIGINT/SIGTERM arriving mid-capture: installTerminationHandlers calls
    // cleanupStack.run() synchronously before the process exits. Do that directly here.
    stack.run();
    sawLockDuringSignal = readLockForTest(lockPath());
  });

  assert.equal(sawLockDuringSignal, null, "the signal-triggered cleanup must have released the lock already");
  // This world starts offline, so startOwnedAvd spawned exactly one fresh emulator: this
  // world's first (and only) spawned pid, 40000.
  assert.deepEqual(world.signals, [{ pid: 40000, signal: "SIGTERM" }]);
  assert.equal(readLockForTest(lockPath()), null, "the normal post-callback cleanup must be a harmless no-op afterward");
});

// ---------------------------------------------------------------------------------------
// reauthOwnedAvd
// ---------------------------------------------------------------------------------------

test("reauthOwnedAvd resolves with the ready payload once the polled state is ready", async () => {
  let calls = 0;
  const xml = await reauthOwnedAvd({
    homeTimeoutMs: 200,
    homePollMs: 5,
    pollHomeState: async () => {
      calls += 1;
      return calls < 3 ? { state: "unknown" } : { state: "ready", value: "<hierarchy>home</hierarchy>" };
    },
  });
  assert.equal(xml, "<hierarchy>home</hierarchy>");
  assert.equal(calls, 3);
});

test("reauthOwnedAvd throws ReauthRequiredError immediately and never retries past it", async () => {
  let calls = 0;
  await assert.rejects(
    reauthOwnedAvd({
      homeTimeoutMs: 5_000,
      homePollMs: 5,
      pollHomeState: async () => {
        calls += 1;
        return { state: "reauth_required" };
      },
    }),
    (error) => error instanceof ReauthRequiredError,
  );
  assert.equal(calls, 1);
});

test("reauthOwnedAvd times out when the state never becomes ready or reauth_required", async () => {
  await assert.rejects(
    reauthOwnedAvd({
      homeTimeoutMs: 30,
      homePollMs: 5,
      pollHomeState: async () => ({ state: "unknown" }),
    }),
    (error) => codeOf(error) === "lifecycle_timeout",
  );
});

test("reauthOwnedAvd requires an injected pollHomeState dependency", async () => {
  await assert.rejects(reauthOwnedAvd({}), (error) => codeOf(error) === "reauth_dependency_missing");
});
