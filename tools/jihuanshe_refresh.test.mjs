// Task 9 -- headless source refresh and visible one-time reauthentication.
//
// NO LIVE OPERATION. Every emulator/ADB/capture-child seam is injected. The lock files, the
// raw-retention directory, and the published snapshots are REAL files under a per-test temporary
// root, because the atomicity/permission/no-clobber guarantees under test are filesystem
// behaviour and a mocked fs would prove nothing about them.
//
// Convention used throughout: the lifecycle seams (startAvd / cleanupLease / signalProcess /
// withAvdLock / recoverAbandonedCapture) RECORD their calls and return benign values, so "the
// outer process never stops an emulator" is asserted as a concrete zero-call negative rather
// than inferred from the absence of a crash.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";

import { EnvironmentError } from "../environment/errors.mjs";
import { finalizeSnapshot, verifySnapshot } from "../environment/snapshot.mjs";
import { publishImmutableArtifact } from "../environment/store.mjs";
import { normalizeJiHuanSheCapture } from "./jihuanshe_normalize.mjs";
import {
  CHILD_STDOUT_LIMIT_BYTES,
  KNOWN_CAPTURE_CODES,
  REFRESH_CODES,
  REFRESH_LOCK_KIND,
  REFRESH_SCHEMA_VERSION,
  REFRESH_STAGES,
  formatRefreshResult,
  parseArguments,
  reauthJiHuanShe,
  refreshExitCode,
  refreshJiHuanShe,
  renderRefreshResult,
  sanitizeEventKey,
  sanitizeSnapshotId,
  statusJiHuanShe,
} from "./jihuanshe_refresh.mjs";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "jihuanshe");
const MAPPING_PATH = join(FIXTURES, "mappings-fixture-v1.json");
const STDERR_SENTINEL = "jihuanshe_capture: dropped 3 market row(s) whose label failed the screen";

function fixtureObject(relativePath) {
  return JSON.parse(readFileSync(join(FIXTURES, relativePath), "utf8"));
}

function bytesOf(value) {
  return Buffer.from(JSON.stringify(value));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// One tournament-batch v2 envelope shaped exactly as Task 8's `collect tournament-batch` prints
// it: { requestWindow: { asOf, windowDays }, events: [ { sourceRef, data } ] }.
function batchEnvelope({
  events = [fixtureObject("capture/tournament-full-field-v2.json")],
  capturedAt = "2026-08-20T12:00:00Z",
  asOf = "2026-08-20",
  windowDays = 30,
  lifecycle = {
    state: "headless-started",
    launchMode: "headless",
    startedByInvocation: true,
    cleanup: { requested: true },
  },
  schemaVersion = 2,
} = {}) {
  return {
    schemaVersion,
    source: "JiHuanShe Android visible UI",
    status: "ok",
    surface: "tournament-batch",
    capturedAt,
    sourceRef: { sanitizedRoute: "app:tournament-index" },
    data: {
      requestWindow: { asOf, windowDays },
      events: events.map((event) => ({ sourceRef: event.sourceRef, data: event.data })),
    },
    lifecycle,
  };
}

function marketEnvelope({ capturedAt = "2026-08-20T12:00:00Z" } = {}) {
  const fixture = fixtureObject("capture/market-visible-viewport-v2.json");
  return {
    ...fixture,
    capturedAt,
    lifecycle: {
      state: "headless-started",
      launchMode: "headless",
      startedByInvocation: true,
      cleanup: { requested: true },
    },
  };
}

function childOk(envelope, extra = {}) {
  return {
    stdout: Buffer.isBuffer(envelope) ? envelope : bytesOf(envelope),
    stderrBytes: 0,
    exitCode: 0,
    killedBySignal: false,
    stdoutTruncated: false,
    ...extra,
  };
}

function childError(code, {
  details = { message: `${code}: synthetic` },
  exitCode = 1,
  stage = "collect",
  surface = "tournament-batch",
} = {}) {
  return {
    stdout: bytesOf({
      schemaVersion: 2,
      source: "JiHuanShe Android visible UI",
      status: "error",
      stage,
      code,
      details,
      surface,
    }),
    // A FAILING child writing a human-readable stderr diagnostic is its documented behaviour;
    // it must never be mistaken for a contract violation, and never enter the result.
    stderrBytes: 64,
    exitCode,
    killedBySignal: false,
    stdoutTruncated: false,
  };
}

function childCrash({ stdout = Buffer.alloc(0), stderrBytes = 0 } = {}) {
  return { stdout, stderrBytes, exitCode: null, killedBySignal: true, stdoutTruncated: false };
}

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "jihuanshe-refresh-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // A seeded alias record: refresh must leave data/environment-aliases/** byte-identical on every
  // path, so the tests that publish anything compare this fingerprint before and after.
  mkdirSync(join(root, "data", "environment-aliases", "SC"), { recursive: true });
  writeFileSync(
    join(root, "data", "environment-aliases", "SC", "latest.json"),
    `${JSON.stringify({ alias: "SC/latest", manifestId: "seeded-manifest-0000000000000000" })}\n`,
  );
  return root;
}

function aliasFingerprint(root) {
  const base = join(root, "data", "environment-aliases");
  const entries = [];
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stats = lstatSync(path);
      if (stats.isDirectory()) {
        walk(path, `${prefix}${name}/`);
        continue;
      }
      entries.push(`${prefix}${name}:${sha256(readFileSync(path))}:${(stats.mode & 0o7777).toString(8)}`);
    }
  };
  if (existsSync(base)) walk(base, "");
  return entries;
}

function sourceDirectory(root, surface) {
  return join(root, "data", "sources", "sc", "jihuanshe", surface);
}

function listSourceFiles(root, surface) {
  const directory = sourceDirectory(root, surface);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort();
}

function baseOptions(root, overrides = {}) {
  return {
    command: "refresh",
    target: "tournaments",
    root,
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
    mappingPath: MAPPING_PATH,
    parserVersion: "jihuanshe-normalizer-v1",
    asOf: "2026-08-20",
    windowDays: 30,
    refreshLockPath: join(root, "refresh.lock"),
    avdLockPath: join(root, "avd-drive.lock"),
    ...overrides,
  };
}

const HEADLESS_LEASE = Object.freeze({
  avd: "JiHuanShe_SC",
  serial: "emulator-5554",
  pid: 111,
  processStartToken: "token-headless",
  launchMode: "headless",
  startedByInvocation: false,
});

// Every lifecycle/ADB seam records its calls. `spawns` records the exact argv arrays the outer
// process would hand to `node`, which is how the fixed-argv and --cleanup-started assertions are
// made without spawning anything. `publishSnapshot` defaults to a RECORDING no-op; pass
// `publishSnapshot: undefined` (see realPublishDeps) to publish real files instead.
function makeDeps(overrides = {}) {
  const calls = {
    spawns: [],
    startAvd: [],
    cleanupLease: [],
    signalProcess: [],
    withAvdLock: [],
    inspectAvd: [],
    recover: [],
    readAvdLock: [],
    publish: [],
    launchLogin: [],
    homeStates: [],
  };
  const deps = {
    now: () => "2026-08-20T12:30:00Z",
    processStartTime: () => "Thu Aug 20 11:00:00 2026",
    isOwnerAlive: () => false,
    captureChild: (request) => {
      calls.spawns.push(request.argv);
      return childOk(batchEnvelope());
    },
    normalize: normalizeJiHuanSheCapture,
    verify: verifySnapshot,
    publishSnapshot: (target) => {
      calls.publish.push(target);
    },
    startAvd: (options) => {
      calls.startAvd.push(options);
      return {
        avd: "JiHuanShe_SC",
        serial: "emulator-5554",
        pid: 4242,
        processStartToken: "token-visible",
        launchMode: "visible",
        startedByInvocation: true,
      };
    },
    cleanupLease: (lease) => {
      calls.cleanupLease.push(lease);
      return { cleaned: true, forced: false };
    },
    signalProcess: (pid, signal) => {
      calls.signalProcess.push({ pid, signal });
    },
    withAvdLock: async (options, callback) => {
      calls.withAvdLock.push(options);
      return callback({ ...HEADLESS_LEASE });
    },
    inspectAvd: () => {
      calls.inspectAvd.push(true);
      return { state: "headless-existing", lease: { ...HEADLESS_LEASE } };
    },
    readAvdLock: (path) => {
      calls.readAvdLock.push(path);
      return null;
    },
    recoverAbandonedCapture: (metadata) => {
      calls.recover.push(metadata);
      return { recovered: true, leaseCleanup: { cleaned: true } };
    },
    launchLoginScreen: () => {
      calls.launchLogin.push(true);
    },
    readHomeState: () => {
      const next = calls.homeStates.length === 0 ? "reauth_required" : "ready";
      calls.homeStates.push(next);
      return next;
    },
    sleep: async () => {},
  };
  return { ...deps, ...overrides, calls };
}

// Publish real files under the temporary root: the tests that assert idempotent reuse, conflict
// beside-publication, and no-rollback need genuine bytes on disk.
function realPublishDeps(overrides = {}) {
  return makeDeps({ publishSnapshot: undefined, ...overrides });
}

// ---------------------------------------------------------------------------------------
// Result contract, exit codes, and the printable form
// ---------------------------------------------------------------------------------------

test("stage and code vocabularies are exactly the specified sets", () => {
  assert.deepEqual([...REFRESH_STAGES], ["lock", "capture", "normalize", "validate", "publish_snapshot", "cleanup"]);
  assert.deepEqual([...REFRESH_CODES].sort(), [
    "cleanup_failed",
    "event_conflict",
    "event_identity_ambiguous",
    "lock_busy",
    "normalization_failed",
    "reauth_required",
    "snapshot_publish_failed",
    "snapshot_validation_failed",
    "ui_contract_changed",
    "unsupported_capture_schema",
  ]);
  assert.equal(REFRESH_SCHEMA_VERSION, 1);
  assert.equal(REFRESH_LOCK_KIND, "refresh-publication");
  assert.equal(CHILD_STDOUT_LIMIT_BYTES, 16 * 1024 * 1024);
});

test("a successful tournament refresh returns the exact sanitized envelope and exit 0", async (t) => {
  const root = makeRoot(t);
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps());

  assert.deepEqual(Object.keys(result).sort(), [
    "code", "lifecycle", "operation", "published", "schemaVersion", "source", "stage", "status", "warnings",
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.source, "jihuanshe");
  assert.equal(result.operation, "refresh");
  assert.equal(result.status, "ok");
  assert.equal(result.stage, "complete");
  assert.equal(result.code, "ok");
  assert.deepEqual(result.lifecycle, {
    stateBefore: "offline", startedByInvocation: true, launchMode: "headless", cleanedUp: true,
  });
  assert.equal(result.published.snapshotIds.length, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(refreshExitCode(result), 0);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
});

test("lifecycle stateBefore reports an ADOPTED emulator and never claims a cleanup that was not requested", async (t) => {
  const root = makeRoot(t);
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({
      lifecycle: {
        state: "headless-existing",
        launchMode: "headless",
        startedByInvocation: false,
        cleanup: { requested: true },
      },
    })),
  }));
  assert.deepEqual(result.lifecycle, {
    stateBefore: "headless-existing", startedByInvocation: false, launchMode: "headless", cleanedUp: false,
  });
});

test("refreshExitCode is 0 only for ok, 2 only for reauth_required, 1 for every other code", () => {
  const shell = (status, code) => ({
    schemaVersion: 1, source: "jihuanshe", operation: "refresh", status, stage: "capture", code,
    lifecycle: { stateBefore: "offline", startedByInvocation: false, launchMode: null, cleanedUp: false },
    published: { snapshotIds: [] }, warnings: [],
  });
  assert.equal(refreshExitCode({ ...shell("ok", "ok"), stage: "complete" }), 0);
  assert.equal(refreshExitCode(shell("error", "reauth_required")), 2);
  for (const code of REFRESH_CODES) {
    if (code === "reauth_required") continue;
    assert.equal(refreshExitCode(shell("error", code)), 1, code);
  }
  assert.equal(refreshExitCode(null), 1);
  assert.equal(refreshExitCode({ status: "ok" }), 1);
  // status/code contradictions can never report success.
  assert.equal(refreshExitCode(shell("ok", "lock_busy")), 1);
  assert.equal(refreshExitCode({ ...shell("error", "ok"), stage: "complete" }), 1);
});

test("formatRefreshResult prints exactly one JSON object and refuses a non-allowlisted result", () => {
  const ok = {
    schemaVersion: 1, source: "jihuanshe", operation: "refresh", status: "ok", stage: "complete", code: "ok",
    lifecycle: { stateBefore: "offline", startedByInvocation: true, launchMode: "headless", cleanedUp: true },
    published: { snapshotIds: [] }, warnings: [],
  };
  const rendered = formatRefreshResult(ok);
  assert.equal(rendered.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(rendered), ok);
  assert.equal(rendered.trimEnd().includes("\n"), false);

  for (const broken of [
    { ...ok, rawBytes: "..." },
    { ...ok, stage: "publishing" },
    { ...ok, code: "made_up" },
    { ...ok, schemaVersion: 2 },
    { ...ok, source: "somewhere else" },
    { ...ok, published: { snapshotIds: "one" } },
    { ...ok, warnings: "none" },
    { ...ok, lifecycle: { stateBefore: "offline" } },
  ]) {
    assert.throws(
      () => formatRefreshResult(broken),
      (error) => error instanceof EnvironmentError && error.code === "refresh_result_invalid",
      JSON.stringify(broken).slice(0, 70),
    );
  }
});

// ---------------------------------------------------------------------------------------
// Two-lock ordering and the outer lock's lifetime
// ---------------------------------------------------------------------------------------

test("the outer refresh-publication lock exists before the child is spawned and is released after", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const observed = [];
  const deps = realPublishDeps({
    captureChild: () => {
      observed.push({
        refreshLockExists: existsSync(options.refreshLockPath),
        avdLockExists: existsSync(options.avdLockPath),
        lockKind: JSON.parse(readFileSync(options.refreshLockPath, "utf8")).kind,
      });
      // The child alone owns avd-drive: it creates and removes its own lock while the outer
      // refresh-publication lock stays held.
      writeFileSync(options.avdLockPath, "child-owned");
      rmSync(options.avdLockPath);
      return childOk(batchEnvelope());
    },
  });

  const result = await refreshJiHuanShe(options, deps);
  assert.equal(result.status, "ok");
  assert.deepEqual(observed, [{ refreshLockExists: true, avdLockExists: false, lockKind: "refresh-publication" }]);
  assert.equal(existsSync(options.refreshLockPath), false);
  assert.equal(existsSync(options.avdLockPath), false);
});

test("the outer refresh lock is held across normalization and publication, not just capture", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const heldDuring = [];
  const result = await refreshJiHuanShe(options, makeDeps({
    normalize: (bytes, context) => {
      heldDuring.push(`normalize:${existsSync(options.refreshLockPath)}`);
      return normalizeJiHuanSheCapture(bytes, context);
    },
    publishSnapshot: () => {
      heldDuring.push(`publish:${existsSync(options.refreshLockPath)}`);
    },
  }));
  assert.equal(result.status, "ok");
  assert.deepEqual(heldDuring, ["normalize:true", "publish:true"]);
});

test("a live foreign owner of the refresh lock yields lock_busy with zero spawns and zero publications", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  writeFileSync(options.refreshLockPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "refresh-publication",
    owner: { pid: 999_001, processStartToken: "other" },
    createdAt: "2026-08-20T11:00:00Z",
  })}\n`);
  const deps = makeDeps({ isOwnerAlive: () => true });

  const result = await refreshJiHuanShe(options, deps);
  assert.equal(result.status, "error");
  assert.equal(result.stage, "lock");
  assert.equal(result.code, "lock_busy");
  assert.equal(refreshExitCode(result), 1);
  assert.deepEqual(result.published.snapshotIds, []);
  assert.deepEqual(deps.calls.spawns, []);
  assert.deepEqual(deps.calls.publish, []);
  // A busy lock is never stolen.
  assert.equal(existsSync(options.refreshLockPath), true);
});

test("a stale refresh lock whose owner is provably dead is reclaimed; one that cannot be proven dead is not", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const stale = {
    schemaVersion: 1,
    kind: "refresh-publication",
    owner: { pid: 999_002, processStartToken: "dead" },
    createdAt: "2026-08-20T11:00:00Z",
  };
  writeFileSync(options.refreshLockPath, `${JSON.stringify(stale)}\n`);
  const reclaimed = await refreshJiHuanShe(options, realPublishDeps({ isOwnerAlive: () => false }));
  assert.equal(reclaimed.status, "ok");
  assert.equal(existsSync(options.refreshLockPath), false);

  // No recorded process-start token means the owner cannot be proven dead: refuse to reclaim.
  writeFileSync(options.refreshLockPath, `${JSON.stringify({ ...stale, owner: { pid: 999_003 } })}\n`);
  const refused = await refreshJiHuanShe(options, makeDeps());
  assert.equal(refused.code, "lock_busy");
  assert.equal(existsSync(options.refreshLockPath), true);
});

test("two concurrent refreshes are mutually exclusive: the second is lock_busy and captures nothing", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  let releaseFirstChild;
  const firstChildStarted = new Promise((started) => {
    releaseFirstChild = started;
  });
  let allowFirstChildToFinish;
  const gate = new Promise((open) => {
    allowFirstChildToFinish = open;
  });

  // `isOwnerAlive: undefined` drops the harness stub so this exercises the REAL liveness check,
  // which must recognise the holder (this very process) as alive and refuse to reclaim its lock.
  const liveness = {
    isOwnerAlive: undefined,
    processStartTime: (pid) => (pid === process.pid ? "Thu Aug 20 11:00:00 2026" : null),
  };
  const first = realPublishDeps({
    ...liveness,
    captureChild: async () => {
      releaseFirstChild();
      await gate;
      return childOk(batchEnvelope());
    },
  });
  const second = makeDeps(liveness);

  const firstRun = refreshJiHuanShe(options, first);
  await firstChildStarted;
  const blocked = await refreshJiHuanShe(options, second);
  allowFirstChildToFinish();
  const completed = await firstRun;

  assert.equal(blocked.code, "lock_busy");
  assert.equal(blocked.stage, "lock");
  assert.deepEqual(second.calls.spawns, []);
  assert.equal(completed.status, "ok");
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
  assert.equal(existsSync(options.refreshLockPath), false);
});

test("a corrupt or foreign-shaped refresh lock file is never treated as free", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  // Unparseable, valid-JSON-but-wrong-kind (e.g. an avd-drive lock aimed at the wrong path),
  // wrong schema version, and a lock with no owner block: none may be stolen.
  for (const contents of [
    "not json at all",
    `${JSON.stringify({ schemaVersion: 1, kind: "avd-drive", owner: { pid: 999_004, processStartToken: "x" } })}\n`,
    `${JSON.stringify({ schemaVersion: 2, kind: "refresh-publication", owner: { pid: 999_005, processStartToken: "x" } })}\n`,
    `${JSON.stringify({ schemaVersion: 1, kind: "refresh-publication" })}\n`,
  ]) {
    writeFileSync(options.refreshLockPath, contents);
    const deps = makeDeps();
    const result = await refreshJiHuanShe(options, deps);
    assert.equal(result.code, "lock_busy", contents.slice(0, 40));
    assert.equal(result.stage, "lock");
    assert.deepEqual(deps.calls.spawns, []);
    assert.equal(readFileSync(options.refreshLockPath, "utf8"), contents);
  }
});

test("the refresh lock is released when the refresh fails", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const result = await refreshJiHuanShe(options, makeDeps({
    captureChild: () => childError("reauth_required", { exitCode: 2 }),
  }));
  assert.equal(result.code, "reauth_required");
  assert.equal(existsSync(options.refreshLockPath), false);
});

test("a refresh lock path equal to the avd-drive lock path is refused before anything runs", async (t) => {
  const root = makeRoot(t);
  const shared = join(root, "same.lock");
  const deps = makeDeps();
  await assert.rejects(
    () => refreshJiHuanShe(baseOptions(root, { refreshLockPath: shared, avdLockPath: shared }), deps),
    (error) => error instanceof EnvironmentError && error.code === "refresh_lock_path_invalid",
  );
  assert.deepEqual(deps.calls.spawns, []);
  assert.equal(existsSync(shared), false);
});

test("an unverifiable own process start token refuses to write a lock at all", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const deps = makeDeps({ processStartTime: () => null });
  await assert.rejects(
    () => refreshJiHuanShe(options, deps),
    (error) => error instanceof EnvironmentError && error.code === "refresh_lock_unverifiable",
  );
  assert.deepEqual(deps.calls.spawns, []);
  assert.equal(existsSync(options.refreshLockPath), false);
});

// ---------------------------------------------------------------------------------------
// The child contract: fixed argv, one object, ceilings, and never stopping an emulator
// ---------------------------------------------------------------------------------------

test("the tournament refresh is ONE child invocation with the certified fixed argument array", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps();
  await refreshJiHuanShe(baseOptions(root, { windowDays: 14, asOf: "2026-08-19" }), deps);

  assert.equal(deps.calls.spawns.length, 1);
  const argv = deps.calls.spawns[0];
  assert.equal(argv[0].endsWith(`${sep}tools${sep}jihuanshe_capture.mjs`), true);
  assert.deepEqual(argv.slice(1), [
    "collect", "tournament-batch", "--as-of", "2026-08-19", "--window-days", "14", "--cleanup-started",
  ]);
});

test("refresh market and refresh all use the certified market argv, and every child cleans what it started", async (t) => {
  const root = makeRoot(t);
  const market = realPublishDeps({
    captureChild: (request) => {
      market.calls.spawns.push(request.argv);
      return childOk(marketEnvelope());
    },
  });
  await refreshJiHuanShe(baseOptions(root, { target: "market" }), market);
  assert.equal(market.calls.spawns.length, 1);
  assert.deepEqual(market.calls.spawns[0].slice(1), ["collect", "market", "--cleanup-started"]);
  assert.equal(listSourceFiles(root, "market").length, 1);

  const both = realPublishDeps({
    captureChild: (request) => {
      both.calls.spawns.push(request.argv);
      return request.argv.includes("market") ? childOk(marketEnvelope()) : childOk(batchEnvelope());
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root, { target: "all" }), both);
  assert.equal(result.status, "ok");
  assert.equal(both.calls.spawns.length, 2);
  assert.equal(both.calls.spawns[0].includes("tournament-batch"), true);
  assert.equal(both.calls.spawns[1].includes("market"), true);
  for (const argv of both.calls.spawns) assert.equal(argv.includes("--cleanup-started"), true);
});

test("the outer process never stops an emulator after a normal child return", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps();
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.status, "ok");
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.withAvdLock, []);
  assert.deepEqual(deps.calls.recover, []);
  assert.deepEqual(deps.calls.readAvdLock, []);
});

test("the outer process performs no emulator cleanup after a normal child FAILURE either", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({ captureChild: () => childError("lifecycle_timeout") });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.status, "error");
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.recover, []);
  assert.deepEqual(deps.calls.readAvdLock, []);
});

test("malformed, empty, and multi-object child stdout publish nothing", async (t) => {
  const root = makeRoot(t);
  for (const stdout of [
    Buffer.from("not json"),
    Buffer.alloc(0),
    Buffer.from(`${JSON.stringify(batchEnvelope())}\n${JSON.stringify(batchEnvelope())}\n`),
    Buffer.from(JSON.stringify([batchEnvelope()])),
    Buffer.from(JSON.stringify("a string")),
  ]) {
    const deps = makeDeps({ captureChild: () => childOk(stdout) });
    const result = await refreshJiHuanShe(baseOptions(root), deps);
    assert.equal(result.status, "error", stdout.toString("utf8").slice(0, 24));
    assert.equal(result.code, "ui_contract_changed");
    assert.equal(result.stage, "capture");
    assert.deepEqual(result.published.snapshotIds, []);
    assert.deepEqual(deps.calls.publish, []);
    assert.equal(listSourceFiles(root, "tournaments").length, 0);
  }
});

test("oversized child stdout publishes nothing and is reported as a contract failure", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({ captureChild: () => childOk(batchEnvelope(), { stdoutTruncated: true }) });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "ui_contract_changed");
  assert.equal(result.details.childOutcome, "stdout_too_large");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.deepEqual(deps.calls.publish, []);
});

test("a schema-incompatible child envelope is unsupported_capture_schema, not normalization_failed", async (t) => {
  const root = makeRoot(t);
  for (const schemaVersion of [1, 3, "2", null]) {
    const deps = makeDeps({ captureChild: () => childOk(batchEnvelope({ schemaVersion })) });
    const result = await refreshJiHuanShe(baseOptions(root), deps);
    assert.equal(result.code, "unsupported_capture_schema", String(schemaVersion));
    assert.equal(result.stage, "capture");
    assert.deepEqual(deps.calls.publish, []);
  }
  const surfaceDeps = makeDeps({ captureChild: () => childOk({ ...batchEnvelope(), surface: "leaderboard" }) });
  const surfaceResult = await refreshJiHuanShe(baseOptions(root), surfaceDeps);
  assert.equal(surfaceResult.code, "unsupported_capture_schema");
  assert.deepEqual(surfaceDeps.calls.publish, []);

  const statusDeps = makeDeps({ captureChild: () => childOk({ ...batchEnvelope(), status: "partial" }) });
  const statusResult = await refreshJiHuanShe(baseOptions(root), statusDeps);
  assert.equal(statusResult.code, "unsupported_capture_schema");

  // A well-formed envelope for the WRONG surface (a market capture answering a tournament
  // request) is refused at the capture gate, before anything is normalized or published.
  const swapped = makeDeps({ captureChild: () => childOk(marketEnvelope()) });
  const swappedResult = await refreshJiHuanShe(baseOptions(root, { target: "tournaments" }), swapped);
  assert.equal(swappedResult.code, "unsupported_capture_schema");
  assert.equal(swappedResult.stage, "capture");
  assert.equal(swappedResult.details.childOutcome, "surface_mismatch");
  assert.deepEqual(swapped.calls.publish, []);
  assert.equal(listSourceFiles(root, "market").length, 0);
});

test("a success-claiming child that wrote to stderr publishes nothing, and no stderr text can reach the result", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    captureChild: () => childOk(batchEnvelope(), { stderrBytes: Buffer.byteLength(STDERR_SENTINEL) }),
  });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.status, "error");
  assert.equal(result.code, "ui_contract_changed");
  assert.equal(result.details.childOutcome, "stderr_present");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.deepEqual(deps.calls.publish, []);
  // The seam only ever carries a byte COUNT, and even that never reaches the result.
  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes(STDERR_SENTINEL), false);
  assert.equal(rendered.includes("dropped"), false);
  assert.equal(/\d{2,}/u.test(JSON.stringify(result.details)), false);
});

test("a child failure code arriving as a plain-Error message prefix is propagated by allowlist only", async (t) => {
  const root = makeRoot(t);
  const mapped = {
    event_key_not_found: "ui_contract_changed",
    event_unreachable: "ui_contract_changed",
    enumeration_did_not_stabilize: "ui_contract_changed",
    event_identity_mismatch: "ui_contract_changed",
    event_identity_unverifiable: "ui_contract_changed",
    event_identity_ambiguous: "event_identity_ambiguous",
  };
  for (const [captureCode, refreshCode] of Object.entries(mapped)) {
    const deps = makeDeps({
      captureChild: () => childError("error", {
        details: { message: `${captureCode}: selected event 合成赛事一/13800138000 vanished` },
      }),
    });
    const result = await refreshJiHuanShe(baseOptions(root), deps);
    assert.equal(result.code, refreshCode, captureCode);
    assert.equal(result.details.captureCode, captureCode);
    // Free text from the child never reaches the result, even though it arrived on stdout.
    const rendered = JSON.stringify(result);
    assert.equal(rendered.includes("合成赛事一"), false);
    assert.equal(rendered.includes("13800138000"), false);
    assert.equal(rendered.includes("vanished"), false);
  }
  assert.equal([...KNOWN_CAPTURE_CODES].includes("lease_recovery_refused"), true);

  const unknown = makeDeps({
    captureChild: () => childError("error", { details: { message: "totally_new_thing: surprise" } }),
  });
  const unknownResult = await refreshJiHuanShe(baseOptions(root), unknown);
  assert.equal(unknownResult.details.captureCode, "unrecognized");
  assert.equal(JSON.stringify(unknownResult).includes("totally_new_thing"), false);
});

test("a child holding avd-drive maps to lock_busy; reauth_required maps to exit 2 with no visible start", async (t) => {
  const root = makeRoot(t);
  const busy = makeDeps({ captureChild: () => childError("avd_lock_held", { details: { pid: 4242 } }) });
  const busyResult = await refreshJiHuanShe(baseOptions(root), busy);
  assert.equal(busyResult.code, "lock_busy");
  assert.equal(busyResult.stage, "capture");
  assert.equal(refreshExitCode(busyResult), 1);
  assert.equal(JSON.stringify(busyResult).includes("4242"), false);

  const reauth = makeDeps({ captureChild: () => childError("reauth_required", { exitCode: 2 }) });
  const reauthResult = await refreshJiHuanShe(baseOptions(root), reauth);
  assert.equal(reauthResult.code, "reauth_required");
  assert.equal(reauthResult.stage, "capture");
  assert.equal(refreshExitCode(reauthResult), 2);
  assert.deepEqual(reauthResult.published.snapshotIds, []);
  // Reauthentication is never automatic: a refresh starts nothing visible.
  assert.deepEqual(reauth.calls.startAvd, []);
  assert.deepEqual(reauth.calls.withAvdLock, []);
});

// ---------------------------------------------------------------------------------------
// Abnormal child: dead-owner proof, then recovery of only that exact lease
// ---------------------------------------------------------------------------------------

test("a child that dies without a CaptureResult triggers recovery of only the recorded lease", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const metadata = {
    schemaVersion: 1,
    kind: "avd-drive",
    owner: { pid: 999_010, processStartToken: "dead-child" },
    createdAt: "2026-08-20T12:00:00Z",
    lease: {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 999_011,
      processStartToken: "leased", launchMode: "headless", startedByInvocation: true,
    },
  };
  const deps = makeDeps({ captureChild: () => childCrash(), readAvdLock: () => metadata });
  const result = await refreshJiHuanShe(options, deps);

  assert.equal(result.status, "error");
  assert.equal(result.code, "ui_contract_changed");
  assert.equal(result.details.childOutcome, "no_capture_result");
  assert.ok(result.warnings.includes("avd_lease_recovered"));
  assert.equal(deps.calls.recover.length, 1);
  assert.deepEqual(deps.calls.recover[0], metadata);
  // Every signal is delegated to the certified recovery primitive; the outer process sends none.
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(result.published.snapshotIds, []);
});

test("recovery refused by the lifecycle module becomes cleanup_failed and still signals nothing", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    captureChild: () => ({
      stdout: Buffer.from("half a jso"), stderrBytes: 12, exitCode: 1, killedBySignal: false, stdoutTruncated: false,
    }),
    readAvdLock: () => ({
      schemaVersion: 1, kind: "avd-drive",
      owner: { pid: 999_020, processStartToken: "dead" },
      createdAt: "2026-08-20T12:00:00Z",
      lease: { pid: 999_021, processStartToken: "leased", launchMode: "headless", startedByInvocation: true },
    }),
    recoverAbandonedCapture: () => {
      throw new EnvironmentError("lease_recovery_refused", "lease_recovery_refused: no", { pid: 999_021 });
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.stage, "cleanup");
  assert.equal(result.details.recovery, "lease_recovery_refused");
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.equal(JSON.stringify(result).includes("999021"), false);
});

test("an abnormal child whose lock owner is still alive is left completely alone", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    captureChild: () => childCrash(),
    readAvdLock: () => ({
      schemaVersion: 1, kind: "avd-drive",
      owner: { pid: 999_030, processStartToken: "alive" },
      createdAt: "2026-08-20T12:00:00Z",
      lease: { pid: 999_031, processStartToken: "leased", launchMode: "headless", startedByInvocation: true },
    }),
    recoverAbandonedCapture: () => {
      throw new EnvironmentError("avd_lock_held", "avd_lock_held: owner alive", { pid: 999_030 });
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "ui_contract_changed");
  assert.ok(result.warnings.includes("avd_lease_owner_alive"));
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
});

test("an abnormal child with no avd-drive lock on disk recovers nothing and invents no lease", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({ captureChild: () => childCrash(), readAvdLock: () => null });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "ui_contract_changed");
  assert.deepEqual(deps.calls.recover, []);
  assert.ok(result.warnings.includes("avd_lease_absent"));
});

// ---------------------------------------------------------------------------------------
// Normalization and validation gates
// ---------------------------------------------------------------------------------------

test("normalization is gated on exit code and status: an error envelope is never normalized", async (t) => {
  const root = makeRoot(t);
  let normalizeCalls = 0;
  const result = await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childError("lifecycle_timeout"),
    normalize: (...args) => {
      normalizeCalls += 1;
      return normalizeJiHuanSheCapture(...args);
    },
  }));
  assert.equal(result.status, "error");
  assert.equal(normalizeCalls, 0);
});

test("a normalizer failure is normalization_failed and publishes nothing", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    normalize: () => {
      throw new EnvironmentError("normalization_failed", "normalization_failed: bad row", { path: "data.rows[0]" });
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "normalization_failed");
  assert.equal(result.stage, "normalize");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.deepEqual(deps.calls.publish, []);
});

test("a normalizer event-identity collision keeps its own stable code", async (t) => {
  const root = makeRoot(t);
  const event = fixtureObject("capture/tournament-full-field-v2.json");
  const deps = makeDeps({ captureChild: () => childOk(batchEnvelope({ events: [event, event] })) });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "event_identity_ambiguous");
  assert.equal(result.stage, "normalize");
  assert.deepEqual(deps.calls.publish, []);
});

test("a candidate whose environment identity, asOf, or hash does not match is refused at validate", async (t) => {
  const root = makeRoot(t);
  const mismatch = await refreshJiHuanShe(baseOptions(root), makeDeps({
    normalize: (bytes, context) => normalizeJiHuanSheCapture(bytes, {
      ...context,
      formatId: "other-format",
      environment: { ...context.environment, formatId: "other-format" },
    }),
  }));
  assert.equal(mismatch.code, "snapshot_validation_failed");
  assert.equal(mismatch.stage, "validate");
  assert.deepEqual(mismatch.published.snapshotIds, []);

  const wrongAsOf = await refreshJiHuanShe(baseOptions(root), makeDeps({
    normalize: (bytes, context) => normalizeJiHuanSheCapture(bytes, { ...context, asOf: "2026-08-01" }),
  }));
  assert.equal(wrongAsOf.code, "snapshot_validation_failed");

  const tamperedDeps = makeDeps({
    normalize: (bytes, context) => {
      const [snapshot] = normalizeJiHuanSheCapture(bytes, context);
      return [{ ...snapshot, contentHash: `sha256:${"0".repeat(64)}` }];
    },
  });
  const tampered = await refreshJiHuanShe(baseOptions(root), tamperedDeps);
  assert.equal(tampered.code, "snapshot_validation_failed");
  assert.deepEqual(tamperedDeps.calls.publish, []);
  assert.equal(listSourceFiles(root, "tournaments").length, 0);
});

test("nothing is published when ANY candidate in the batch fails validation", async (t) => {
  const root = makeRoot(t);
  const first = fixtureObject("capture/tournament-full-field-v2.json");
  const second = JSON.parse(JSON.stringify(first));
  second.sourceRef = { ...first.sourceRef, providerEventId: "fixture-event-002" };
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [first, second] })),
    normalize: (bytes, context) => {
      const snapshots = normalizeJiHuanSheCapture(bytes, context);
      return [snapshots[0], { ...snapshots[1], kind: "leaderboard" }];
    },
  }));
  assert.equal(result.code, "snapshot_validation_failed");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.equal(listSourceFiles(root, "tournaments").length, 0);
});

// ---------------------------------------------------------------------------------------
// Publication: layout, reuse, conflict, and no rollback
// ---------------------------------------------------------------------------------------

test("published snapshots land under data/sources/sc/jihuanshe/<surface> and verify on read", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps({
    captureChild: (request) => (request.argv.includes("market") ? childOk(marketEnvelope()) : childOk(batchEnvelope())),
  });
  const result = await refreshJiHuanShe(baseOptions(root, { target: "all" }), deps);
  assert.equal(result.status, "ok");
  assert.equal(result.published.snapshotIds.length, 2);

  const tournaments = listSourceFiles(root, "tournaments");
  const market = listSourceFiles(root, "market");
  assert.equal(tournaments.length, 1);
  assert.equal(market.length, 1);
  for (const [surface, files] of [["tournaments", tournaments], ["market", market]]) {
    for (const name of files) {
      const snapshot = JSON.parse(readFileSync(join(sourceDirectory(root, surface), name), "utf8"));
      assert.equal(verifySnapshot(snapshot), snapshot);
      assert.equal(`${snapshot.snapshotId}.json`, name);
      assert.ok(result.published.snapshotIds.includes(snapshot.snapshotId));
    }
  }
});

test("identical evidence at a later capture time reuses the original snapshot with observation_reused", async (t) => {
  const root = makeRoot(t);
  const first = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  assert.equal(first.status, "ok");
  const originalId = first.published.snapshotIds[0];
  const originalBytes = readFileSync(join(sourceDirectory(root, "tournaments"), `${originalId}.json`));

  const later = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ capturedAt: "2026-08-20T18:45:00Z" })),
  }));
  assert.equal(later.status, "ok");
  assert.deepEqual(later.published.snapshotIds, [originalId]);
  assert.ok(later.warnings.includes("observation_reused"));
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
  assert.deepEqual(readFileSync(join(sourceDirectory(root, "tournaments"), `${originalId}.json`)), originalBytes);

  // Byte-identical bytes are idempotent too.
  const again = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  assert.equal(again.status, "ok");
  assert.deepEqual(again.published.snapshotIds, [originalId]);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
});

test("changed evidence publishes a new version BESIDE the old one and returns event_conflict with exit 1", async (t) => {
  const root = makeRoot(t);
  const before = aliasFingerprint(root);
  const first = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  const originalId = first.published.snapshotIds[0];
  const originalBytes = readFileSync(join(sourceDirectory(root, "tournaments"), `${originalId}.json`));

  const changedEvent = fixtureObject("capture/tournament-full-field-v2.json");
  changedEvent.data.results.rows[3].score = 1;
  const conflicted = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [changedEvent] })),
  }));

  assert.equal(conflicted.status, "error");
  assert.equal(conflicted.code, "event_conflict");
  assert.equal(conflicted.stage, "publish_snapshot");
  assert.equal(refreshExitCode(conflicted), 1);
  assert.equal(conflicted.published.snapshotIds.length, 1);
  const newId = conflicted.published.snapshotIds[0];
  assert.notEqual(newId, originalId);
  assert.ok(conflicted.warnings.some((warning) => warning.startsWith("event_conflict:")));
  assert.equal(conflicted.details.conflicts[0].snapshotId, newId);
  assert.equal(conflicted.details.conflicts[0].eventKey, "jihuanshe:tournament:fixture-event-001");

  // Both immutable versions exist; neither was overwritten nor rolled back.
  assert.equal(listSourceFiles(root, "tournaments").length, 2);
  assert.deepEqual(readFileSync(join(sourceDirectory(root, "tournaments"), `${originalId}.json`)), originalBytes);
  assert.equal(existsSync(join(sourceDirectory(root, "tournaments"), `${newId}.json`)), true);
  // A conflict never advances an alias.
  assert.deepEqual(aliasFingerprint(root), before);
});

test("a phone-shaped provider event key is redacted out of the conflict details and warnings", async (t) => {
  const root = makeRoot(t);
  const hostile = fixtureObject("capture/tournament-full-field-v2.json");
  hostile.sourceRef = { ...hostile.sourceRef, providerEventId: "13800138000" };
  const first = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [hostile] })),
  }));
  assert.equal(first.status, "ok");

  const changed = JSON.parse(JSON.stringify(hostile));
  changed.data.results.rows[1].score = 5;
  const conflicted = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [changed] })),
  }));
  assert.equal(conflicted.code, "event_conflict");
  // I-2: the derived fallback key is not the `jihuanshe:tournament:<id>` shape EVENT_KEY_PATTERN
  // accepts, so the outbound screen still collapses it to the bare marker. The conflict record's
  // sanitized snapshotId is what distinguishes two redacted events from one another.
  assert.equal(conflicted.details.conflicts[0].eventKey, "jihuanshe:tournament:redacted");
  assert.match(conflicted.details.conflicts[0].snapshotId, /^jihuanshe-tournament-redacted-[0-9a-f]{16}$/u);
  assert.equal(conflicted.warnings.some((warning) => warning.includes("13800138000")), false);
  assert.equal(conflicted.details.conflicts[0].eventKey.includes("13800138000"), false);
});

test("a market publication failure never rolls back the tournament snapshot or fabricates strength data", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    captureChild: (request) => (request.argv.includes("market") ? childOk(marketEnvelope()) : childOk(batchEnvelope())),
    publishSnapshot: (target, snapshot) => {
      if (snapshot.kind === "market") {
        throw new EnvironmentError("artifact_write_invalid", "artifact_write_invalid: disk full", {});
      }
      publishImmutableArtifact(target, snapshot);
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root, { target: "all" }), deps);

  assert.equal(result.status, "error");
  assert.equal(result.code, "snapshot_publish_failed");
  assert.equal(result.stage, "publish_snapshot");
  assert.equal(result.published.snapshotIds.length, 1);
  const [tournamentId] = result.published.snapshotIds;
  const published = JSON.parse(readFileSync(join(sourceDirectory(root, "tournaments"), `${tournamentId}.json`), "utf8"));
  assert.equal(verifySnapshot(published), published);
  assert.equal(published.kind, "tournament_event");
  assert.equal(listSourceFiles(root, "market").length, 0);
  // No fabricated market/strength content anywhere in the result.
  const rendered = JSON.stringify(result);
  for (const forbidden of ["strength", "observedPrice", "CNY", "¥", "price"]) {
    assert.equal(rendered.includes(forbidden), false, forbidden);
  }
});

test("a publish failure mid-batch keeps the events already published and reports exactly those", async (t) => {
  const root = makeRoot(t);
  const first = fixtureObject("capture/tournament-full-field-v2.json");
  const second = JSON.parse(JSON.stringify(first));
  second.sourceRef = { ...first.sourceRef, providerEventId: "fixture-event-002" };
  let published = 0;
  const result = await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childOk(batchEnvelope({ events: [first, second] })),
    publishSnapshot: (target, snapshot) => {
      published += 1;
      if (published === 2) throw new EnvironmentError("artifact_write_invalid", "artifact_write_invalid: nope", {});
      publishImmutableArtifact(target, snapshot);
    },
  }));

  assert.equal(result.code, "snapshot_publish_failed");
  assert.equal(result.stage, "publish_snapshot");
  assert.equal(result.published.snapshotIds.length, 1);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
  assert.equal(`${result.published.snapshotIds[0]}.json`, listSourceFiles(root, "tournaments")[0]);
});

test("the refresh lock is never deleted when it no longer belongs to this invocation", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const foreign = `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-publication",
    owner: { pid: 999_060, processStartToken: "someone-else" }, createdAt: "2026-08-20T13:00:00Z",
  })}\n`;
  const result = await refreshJiHuanShe(options, realPublishDeps({
    captureChild: () => {
      // Another invocation legitimately reclaimed the lock while this one was capturing.
      writeFileSync(options.refreshLockPath, foreign);
      return childOk(batchEnvelope());
    },
  }));
  assert.equal(result.status, "ok");
  assert.equal(existsSync(options.refreshLockPath), true);
  assert.equal(readFileSync(options.refreshLockPath, "utf8"), foreign);
});

test("stale publisher temp files from a dead process are cleared before publishing; live ones are not", async (t) => {
  const root = makeRoot(t);
  const directory = sourceDirectory(root, "tournaments");
  mkdirSync(directory, { recursive: true });
  const stale = join(directory, ".stale.json.999040.aaaabbbb.tmp");
  const live = join(directory, `.live.json.${process.pid}.ccccdddd.tmp`);
  writeFileSync(stale, "{}");
  writeFileSync(live, "{}");
  const old = Date.now() / 1000 - 3600;
  utimesSync(stale, old, old);
  utimesSync(live, old, old);

  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  assert.equal(result.status, "ok");
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(live), true);
});

test("an unverifiable existing snapshot in the target directory fails closed instead of publishing", async (t) => {
  const root = makeRoot(t);
  const directory = sourceDirectory(root, "tournaments");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "jihuanshe-tournament-tampered-0000000000000000.json"), '{"schemaVersion":1}\n');

  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  assert.equal(result.status, "error");
  assert.equal(result.code, "snapshot_validation_failed");
  assert.equal(result.stage, "validate");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
});

test("refresh NEVER writes under data/environment-aliases on any path", async (t) => {
  const root = makeRoot(t);
  const before = aliasFingerprint(root);
  assert.equal(before.length, 1);

  const targets = [];
  const recordingPublish = (target, snapshot) => {
    targets.push(target);
    publishImmutableArtifact(target, snapshot);
  };
  // success
  await refreshJiHuanShe(baseOptions(root), makeDeps({ publishSnapshot: recordingPublish }));
  // failure before publication
  await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childOk(Buffer.from("{")), publishSnapshot: recordingPublish,
  }));
  // abnormal child
  await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childCrash(), publishSnapshot: recordingPublish,
  }));
  // conflict
  const changed = fixtureObject("capture/tournament-full-field-v2.json");
  changed.data.results.rows[0].score = 11;
  const conflict = await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childOk(batchEnvelope({ events: [changed] })), publishSnapshot: recordingPublish,
  }));
  assert.equal(conflict.code, "event_conflict");

  assert.deepEqual(aliasFingerprint(root), before);
  assert.equal(targets.length, 2);
  for (const target of targets) {
    assert.equal(resolve(target).includes(`${sep}environment-aliases${sep}`), false, target);
    assert.equal(resolve(target).startsWith(resolve(sourceDirectory(root, "tournaments")) + sep), true, target);
  }
  assert.equal(existsSync(join(root, "data", "derived")), false);
});

// ---------------------------------------------------------------------------------------
// Privacy of the result object
// ---------------------------------------------------------------------------------------

test("no raw bytes, participant sentinels, tokens, or filesystem paths reach the result", async (t) => {
  const root = makeRoot(t);
  const retention = join(root, "raw");
  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: retention }), realPublishDeps());
  assert.equal(result.status, "ok");

  const rendered = JSON.stringify(result);
  for (const forbidden of [
    "synthetic-entrant", "joinToken", "合成红艾斯", "赛果", "已结束",
    "emulator-5554", "JiHuanShe_SC", "processStartToken", "Bearer", "手机号",
    root, retention, "/private", "/Users",
  ]) {
    assert.equal(rendered.includes(forbidden), false, forbidden);
  }
  assert.equal(rendered.includes("jihuanshe-tournament-"), true);
});

// ---------------------------------------------------------------------------------------
// Optional raw retention
// ---------------------------------------------------------------------------------------

test("--retain-raw writes the exact bytes with 0700/0600 permissions and reports only a sanitized status", async (t) => {
  const root = makeRoot(t);
  const retention = join(root, "diagnostic-raw");
  const bytes = bytesOf(batchEnvelope());
  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: retention }), realPublishDeps({
    captureChild: () => childOk(bytes),
  }));

  assert.equal(result.status, "ok");
  assert.deepEqual(result.details.retention, { retained: true, files: 1 });
  assert.equal(JSON.stringify(result).includes(retention), false);

  assert.equal(lstatSync(retention).mode & 0o777, 0o700);
  const files = readdirSync(retention);
  assert.equal(files.length, 1);
  const path = join(retention, files[0]);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(path), bytes);
});

test("without --retain-raw no raw file operation happens at all", async (t) => {
  const root = makeRoot(t);
  let retainCalls = 0;
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    retainRaw: () => {
      retainCalls += 1;
      return { retained: false };
    },
  }));
  assert.equal(result.status, "ok");
  assert.equal(retainCalls, 0);
  assert.equal(result.details, undefined);
  assert.equal(existsSync(join(root, "raw")), false);
});

test("a symlinked retention directory is refused without writing through it, and refresh still publishes", async (t) => {
  const root = makeRoot(t);
  const real = join(root, "outside");
  mkdirSync(real, { recursive: true });
  const link = join(root, "linked-raw");
  symlinkSync(real, link);

  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: link }), realPublishDeps());
  assert.equal(result.status, "ok");
  assert.deepEqual(result.details.retention, { retained: false, reason: "symlink_refused" });
  assert.ok(result.warnings.includes("raw_retention_refused"));
  assert.deepEqual(readdirSync(real), []);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
  // A refused retention reports no path either.
  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes(link), false);
  assert.equal(rendered.includes(real), false);
});

test("a retention directory with loose permissions is refused rather than silently reused", async (t) => {
  const root = makeRoot(t);
  const loose = join(root, "loose-raw");
  mkdirSync(loose, { recursive: true });
  chmodSync(loose, 0o755);
  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: loose }), realPublishDeps());
  assert.equal(result.status, "ok");
  assert.equal(result.details.retention.retained, false);
  assert.equal(result.details.retention.reason, "directory_mode_refused");
  assert.ok(result.warnings.includes("raw_retention_refused"));
  assert.deepEqual(readdirSync(loose), []);
});

// ---------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------

test("status inspects only, never starting, stopping, capturing, or publishing", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps();
  const result = await statusJiHuanShe(baseOptions(root, { command: "status", target: undefined }), deps);

  assert.equal(result.operation, "status");
  assert.equal(result.status, "ok");
  assert.equal(result.stage, "complete");
  assert.equal(result.code, "ok");
  assert.equal(refreshExitCode(result), 0);
  assert.equal(result.details.avdState, "headless-existing");
  assert.equal(result.details.refreshLockHeld, false);
  assert.deepEqual(result.details.snapshotCounts, { tournaments: 0, market: 0 });
  assert.deepEqual(deps.calls.spawns, []);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.publish, []);
  // No pid, token, serial, or path is ever reported.
  const rendered = JSON.stringify(result);
  for (const forbidden of ["111", "token-headless", "emulator-5554", root]) {
    assert.equal(rendered.includes(forbidden), false, forbidden);
  }
});

test("status counts already published snapshots without touching them", async (t) => {
  const root = makeRoot(t);
  await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  const result = await statusJiHuanShe(baseOptions(root, { command: "status", target: undefined }), makeDeps());
  assert.deepEqual(result.details.snapshotCounts, { tournaments: 1, market: 0 });
});

test("status reports a held refresh lock and degrades to an unknown AVD state instead of failing", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root, { command: "status", target: undefined });
  writeFileSync(options.refreshLockPath, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-publication",
    owner: { pid: 999_050, processStartToken: "alive" }, createdAt: "2026-08-20T12:00:00Z",
  })}\n`);
  const result = await statusJiHuanShe(options, makeDeps({
    isOwnerAlive: () => true,
    inspectAvd: () => {
      throw new Error("adb not found");
    },
  }));
  assert.equal(result.status, "ok");
  assert.equal(result.details.refreshLockHeld, true);
  assert.equal(result.details.avdState, "unknown");
  assert.ok(result.warnings.includes("avd_state_unknown"));
  assert.equal(existsSync(options.refreshLockPath), true);
});

// ---------------------------------------------------------------------------------------
// Visible one-time reauthentication
// ---------------------------------------------------------------------------------------

test("reauth returns lock_busy when another invocation holds avd-drive and starts nothing visible", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    withAvdLock: async () => {
      throw new EnvironmentError("avd_lock_held", "avd_lock_held: busy", { pid: 4242 });
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.operation, "reauth");
  assert.equal(result.status, "error");
  assert.equal(result.code, "lock_busy");
  assert.equal(result.stage, "lock");
  assert.equal(refreshExitCode(result), 1);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.launchLogin, []);
  assert.equal(JSON.stringify(result).includes("4242"), false);
});

test("reauth stops only the exact verified headless process, starts visibly, then stops what it started", async (t) => {
  const root = makeRoot(t);
  const order = [];
  const deps = makeDeps({
    signalProcess: (pid, signal) => {
      order.push(`signal:${pid}:${signal}`);
      deps.calls.signalProcess.push({ pid, signal });
    },
    inspectAvd: () => {
      deps.calls.inspectAvd.push(true);
      // Offline once the exact process has been signalled.
      if (order.some((entry) => entry.startsWith("signal:"))) return { state: "offline" };
      return { state: "headless-existing", lease: { ...HEADLESS_LEASE } };
    },
    startAvd: (options) => {
      order.push(`start:${options.launchMode}`);
      deps.calls.startAvd.push(options);
      return {
        avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 4242,
        processStartToken: "token-visible", launchMode: "visible", startedByInvocation: true,
      };
    },
    launchLoginScreen: () => {
      order.push("login");
      deps.calls.launchLogin.push(true);
    },
    cleanupLease: (lease) => {
      order.push(`cleanup:${lease.pid}`);
      deps.calls.cleanupLease.push(lease);
      return { cleaned: true, forced: false };
    },
  });

  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.status, "ok");
  assert.equal(result.code, "ok");
  assert.deepEqual(result.lifecycle, {
    stateBefore: "headless-existing", startedByInvocation: true, launchMode: "visible", cleanedUp: true,
  });
  assert.deepEqual(order, ["signal:111:SIGTERM", "start:visible", "login", "cleanup:4242"]);
  assert.deepEqual(deps.calls.signalProcess, [{ pid: 111, signal: "SIGTERM" }]);
  assert.equal(deps.calls.cleanupLease.length, 1);
  assert.equal(deps.calls.cleanupLease[0].pid, 4242);
  assert.equal(deps.calls.cleanupLease[0].startedByInvocation, true);
  assert.equal(deps.calls.startAvd[0].launchMode, "visible");
  // The visible start never asks for the headless window flag.
  assert.equal(JSON.stringify(deps.calls.startAvd[0]).includes("-no-window"), false);
});

test("reauth on an offline AVD started visibly by the lock stops that exact lease after login", async (t) => {
  const root = makeRoot(t);
  const visibleLease = {
    avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 5555,
    processStartToken: "token-visible-started", launchMode: "visible", startedByInvocation: true,
  };
  const deps = makeDeps({
    withAvdLock: async (options, callback) => {
      deps.calls.withAvdLock.push(options);
      return callback({ ...visibleLease });
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.lifecycle, {
    stateBefore: "offline", startedByInvocation: true, launchMode: "visible", cleanedUp: true,
  });
  assert.equal(deps.calls.withAvdLock[0].launchMode, "visible");
  assert.equal(deps.calls.withAvdLock[0].cleanupStartedOnFinish, false);
  // No pre-existing process was signalled, and nothing extra was started.
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.cleanupLease, [{ ...visibleLease }]);
});

test("reauth refuses to signal anything when the live AVD identity does not match the lease", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    inspectAvd: () => {
      deps.calls.inspectAvd.push(true);
      return {
        state: "headless-existing",
        lease: { ...HEADLESS_LEASE, pid: 222, processStartToken: "token-different" },
      };
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.status, "error");
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.stage, "cleanup");
  assert.equal(result.details.reason, "avd_identity_unverifiable");
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.launchLogin, []);
});

test("an already visible owner-started AVD is attached and left running", async (t) => {
  const root = makeRoot(t);
  const visible = {
    avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 777,
    processStartToken: "token-visible-existing", launchMode: "visible", startedByInvocation: false,
  };
  const deps = makeDeps({
    withAvdLock: async (options, callback) => {
      deps.calls.withAvdLock.push(options);
      return callback({ ...visible });
    },
    inspectAvd: () => {
      deps.calls.inspectAvd.push(true);
      return { state: "visible-existing", lease: { ...visible } };
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.lifecycle, {
    stateBefore: "visible-existing", startedByInvocation: false, launchMode: "visible", cleanedUp: false,
  });
  assert.ok(result.warnings.includes("attached_existing_visible_avd"));
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.startAvd, []);
  assert.deepEqual(deps.calls.launchLogin, [true]);
});

test("a login that never reaches the ready home state leaves the visible AVD running and reports reauth_required", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    withAvdLock: async (options, callback) => {
      deps.calls.withAvdLock.push(options);
      return callback({
        avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 6666,
        processStartToken: "token-visible-started", launchMode: "visible", startedByInvocation: true,
      });
    },
    readHomeState: () => {
      deps.calls.homeStates.push("reauth_required");
      return "reauth_required";
    },
  });
  const result = await reauthJiHuanShe(
    baseOptions(root, { command: "reauth", target: undefined, loginTimeoutMs: 5, loginPollMs: 1 }),
    deps,
  );
  assert.equal(result.status, "error");
  assert.equal(result.code, "reauth_required");
  assert.equal(refreshExitCode(result), 2);
  assert.ok(result.warnings.includes("visible_avd_left_running"));
  // Never stop a visible emulator the owner may still be typing into.
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.ok(deps.calls.homeStates.length >= 1);
});

test("reauth never accepts a phone number, SMS code, or credential as an argument", () => {
  for (const argv of [
    ["reauth", "--phone", "13800138000"],
    ["reauth", "--sms-code", "123456"],
    ["reauth", "--code", "123456"],
    ["reauth", "--password", "hunter2"],
    ["reauth", "--token", "abc"],
  ]) {
    assert.throws(
      () => parseArguments(argv),
      (error) => error instanceof EnvironmentError && error.code === "refresh_input_invalid",
      argv[1],
    );
  }
});

// ---------------------------------------------------------------------------------------
// Argument boundary
// ---------------------------------------------------------------------------------------

test("parseArguments accepts the documented commands and defaults, and refuses the rest", () => {
  const tournaments = parseArguments(["refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "30"]);
  assert.equal(tournaments.command, "refresh");
  assert.equal(tournaments.target, "tournaments");
  assert.equal(tournaments.asOf, "2026-08-20");
  assert.equal(tournaments.windowDays, 30);
  assert.equal(tournaments.timeZone, "Asia/Shanghai");
  assert.equal(tournaments.formatId.length > 0, true);
  assert.equal(tournaments.parserVersion.length > 0, true);
  assert.notEqual(tournaments.refreshLockPath, tournaments.avdLockPath);
  assert.equal(tournaments.retainRawDir, undefined);

  const market = parseArguments(["refresh", "market"]);
  assert.equal(market.target, "market");
  assert.match(market.asOf, /^\d{4}-\d{2}-\d{2}$/u);

  assert.equal(parseArguments(["status"]).command, "status");
  assert.equal(parseArguments(["reauth"]).command, "reauth");

  for (const argv of [
    [],
    ["refresh"],
    ["refresh", "everything"],
    ["refresh", "tournaments"],
    ["refresh", "tournaments", "--as-of", "2026-08-20"],
    ["refresh", "tournaments", "--as-of", "20260820", "--window-days", "30"],
    ["refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "0"],
    ["refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "-1"],
    ["refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "30", "--as-of"],
    ["refresh", "market", "--unknown", "x"],
    ["frobnicate"],
    ["status", "extra"],
  ]) {
    assert.throws(
      () => parseArguments(argv),
      (error) => error instanceof EnvironmentError && error.code === "refresh_input_invalid",
      JSON.stringify(argv),
    );
  }
});

test("every result this module produces survives formatRefreshResult and maps to a sane exit code", async (t) => {
  const root = makeRoot(t);
  const changed = fixtureObject("capture/tournament-full-field-v2.json");
  changed.data.results.rows[2].rank = 9;
  const produced = [];
  produced.push(await refreshJiHuanShe(baseOptions(root), realPublishDeps()));
  produced.push(await refreshJiHuanShe(baseOptions(root), realPublishDeps()));
  produced.push(await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [changed] })),
  })));
  produced.push(await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childError("reauth_required", { exitCode: 2 }),
  })));
  produced.push(await refreshJiHuanShe(baseOptions(root), makeDeps({ captureChild: () => childCrash() })));
  produced.push(await refreshJiHuanShe(baseOptions(root), makeDeps({
    captureChild: () => childOk(Buffer.from("nope")),
  })));
  produced.push(await statusJiHuanShe(baseOptions(root, { command: "status", target: undefined }), makeDeps()));
  produced.push(await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), makeDeps()));
  produced.push(await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), makeDeps({
    withAvdLock: async () => {
      throw new EnvironmentError("avd_lock_held", "avd_lock_held: busy", {});
    },
  })));

  const codes = new Set();
  for (const result of produced) {
    const rendered = formatRefreshResult(result);
    assert.deepEqual(JSON.parse(rendered), result);
    assert.ok([0, 1, 2].includes(refreshExitCode(result)));
    codes.add(result.code);
  }
  // The set above really does exercise several distinct stable codes, not one repeated shape.
  assert.ok(codes.size >= 5, [...codes].join(","));
});

// The CLI boundary itself, exercised ONLY through invalid arguments: those paths fail inside
// parseArguments, so no capture child, emulator, or adb call is reachable from here.
test("the CLI prints one sanitized object and exits 1 for a refused argument list", () => {
  for (const [argv, expectedOperation] of [
    [[], "status"],
    [["refresh", "bogus"], "refresh"],
    [["refresh", "tournaments"], "refresh"],
    [["reauth", "--sms-code", "123456"], "reauth"],
    [["reauth", "--phone", "13800138000"], "reauth"],
  ]) {
    const run = spawnSync(process.execPath, [join(process.cwd(), "tools", "jihuanshe_refresh.mjs"), ...argv], {
      encoding: "utf8", shell: false, timeout: 30_000,
    });
    assert.equal(run.status, 1, JSON.stringify(argv));
    const lines = run.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 1, run.stdout);
    const result = JSON.parse(lines[0]);
    assert.equal(result.status, "error");
    assert.equal(result.stage, "arguments");
    assert.equal(result.code, "refresh_input_invalid");
    assert.equal(result.operation, expectedOperation);
    // No argument value is echoed back, credentials least of all.
    for (const forbidden of ["123456", "13800138000", "bogus"]) {
      assert.equal(run.stdout.includes(forbidden), false, forbidden);
    }
  }
});

test("--max-scrolls is validated and passed through to the capture child", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps();
  await refreshJiHuanShe(baseOptions(root, { maxScrolls: 12 }), deps);
  assert.deepEqual(deps.calls.spawns[0].slice(-3), ["--cleanup-started", "--max-scrolls", "12"]);
  assert.equal(
    parseArguments(["refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "30", "--max-scrolls", "12"]).maxScrolls,
    12,
  );
  assert.throws(
    () => parseArguments([
      "refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "30", "--max-scrolls", "0",
    ]),
    (error) => error instanceof EnvironmentError && error.code === "refresh_input_invalid",
  );
});

// =======================================================================================
// Fix round 1 -- R1, I1-I6, M3, M5, and the planted mutation survivors V2/V7/V8/V10/V11.
// =======================================================================================

test("R1: an empty capture window is success-with-warning, not a failure", async (t) => {
  const root = makeRoot(t);
  // Task 8 raises this as a plain Error, so it arrives as code "error" with a message prefix.
  for (const child of [
    () => childError("error", { details: { message: "no_events_in_window: nothing in 30 day(s) of 2026-08-20" } }),
    () => childError("no_events_in_window"),
  ]) {
    const deps = makeDeps({ captureChild: child });
    const result = await refreshJiHuanShe(baseOptions(root), deps);
    assert.equal(result.status, "ok");
    assert.equal(result.stage, "complete");
    assert.equal(result.code, "ok");
    assert.equal(refreshExitCode(result), 0);
    assert.deepEqual(result.published.snapshotIds, []);
    assert.ok(result.warnings.includes("no_events_in_window"));
    assert.deepEqual(deps.calls.publish, []);
    // (c) the v2 error envelope carries no lifecycle block, so nothing is fabricated.
    assert.equal(result.lifecycle.stateBefore, "unknown");
    assert.equal(result.lifecycle.startedByInvocation, false);
    assert.equal(result.lifecycle.launchMode, null);
    assert.equal(result.lifecycle.cleanedUp, false);
    // No emulator cleanup is attempted for a normal child return.
    assert.deepEqual(deps.calls.recover, []);
    assert.deepEqual(deps.calls.signalProcess, []);
  }
});

test("R1: an empty tournament window does not abort the market surface of refresh all", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps({
    captureChild: (request) => {
      deps.calls.spawns.push(request.argv);
      return request.argv.includes("market")
        ? childOk(marketEnvelope())
        : childError("error", { details: { message: "no_events_in_window: nothing" } });
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root, { target: "all" }), deps);
  assert.equal(result.status, "ok");
  assert.equal(result.code, "ok");
  assert.ok(result.warnings.includes("no_events_in_window"));
  assert.equal(deps.calls.spawns.length, 2);
  assert.equal(result.published.snapshotIds.length, 1);
  assert.equal(listSourceFiles(root, "market").length, 1);
  assert.equal(listSourceFiles(root, "tournaments").length, 0);
  // The market child DID report a lifecycle, so the block is real rather than unknown.
  assert.equal(result.lifecycle.stateBefore, "offline");
  assert.equal(result.lifecycle.launchMode, "headless");
});

test("I-2: the reported id, the on-disk FILENAME and the snapshot BODY all agree on the redacted form", async (t) => {
  const root = makeRoot(t);
  const hostile = fixtureObject("capture/tournament-full-field-v2.json");
  hostile.sourceRef = { ...hostile.sourceRef, providerEventId: "13800138000" };

  const first = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [hostile] })),
  }));
  assert.equal(first.status, "ok");
  assert.equal(first.published.snapshotIds.length, 1);
  assert.match(first.published.snapshotIds[0], /^jihuanshe-tournament-redacted-[0-9a-f]{16}$/u);
  assert.equal(JSON.stringify(first).includes("13800138000"), false);

  // THIS ASSERTION USED TO READ `true`. The artifact was written under its RAW name while only the
  // stdout surface was redacted, and the test pinned that divergence as intended behaviour. The
  // normalizer now redacts at birth, so the id and the filename are byte-equal again and the body
  // carries the same redacted form.
  const [file] = listSourceFiles(root, "tournaments");
  assert.equal(file.includes("13800138000"), false);
  assert.equal(file, `${first.published.snapshotIds[0]}.json`);
  const body = JSON.parse(readFileSync(join(sourceDirectory(root, "tournaments"), file), "utf8"));
  assert.equal(JSON.stringify(body).includes("13800138000"), false);
  assert.equal(body.snapshotId, first.published.snapshotIds[0]);
  assert.equal(body.source.sourceRef.providerEventId, "redacted");
  verifySnapshot(body);

  const changed = JSON.parse(JSON.stringify(hostile));
  changed.data.results.rows[1].score = 5;
  const conflicted = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [changed] })),
  }));
  assert.equal(conflicted.code, "event_conflict");
  assert.match(conflicted.details.conflicts[0].snapshotId, /^jihuanshe-tournament-redacted-[0-9a-f]{16}$/u);
  assert.equal(conflicted.details.conflicts[0].eventKey, "jihuanshe:tournament:redacted");
  assert.equal(JSON.stringify(conflicted).includes("13800138000"), false);
  // The reuse path agrees with the publish path.
  const reused = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(batchEnvelope({ events: [hostile], capturedAt: "2026-08-20T19:00:00Z" })),
  }));
  assert.ok(reused.warnings.includes("observation_reused"));
  assert.equal(JSON.stringify(reused).includes("13800138000"), false);
  assert.deepEqual(listSourceFiles(root, "tournaments").filter((name) => name.includes("13800138000")), []);
});

test("I-2: the residual on-disk sanitizer carries no preimage of the id it redacts", () => {
  // The normalizer is now the single point of redaction, but `sanitizeSnapshotId` still sees ids
  // read off DISK -- artifacts published by an older build. Its redacted form must therefore also
  // be preimage-free: a fixed marker plus the artifact's OWN 16-hex content-hash suffix, never
  // `sha256(stem)`, which was 64 unsalted bits over an 11-digit template.
  assert.equal(
    sanitizeSnapshotId("jihuanshe-tournament-13800138000-0123456789abcdef"),
    "jihuanshe-tournament-redacted-0123456789abcdef",
  );
  assert.equal(
    sanitizeSnapshotId("jihuanshe-tournament-13911112222-0123456789abcdef"),
    "jihuanshe-tournament-redacted-0123456789abcdef",
  );
  assert.equal(sanitizeSnapshotId("13800138000"), "redacted");
  assert.equal(sanitizeSnapshotId(""), "redacted");
  assert.equal(sanitizeEventKey("jihuanshe:tournament:13800138000"), "jihuanshe:tournament:redacted");
  assert.equal(sanitizeEventKey("jihuanshe:tournament:13911112222"), "jihuanshe:tournament:redacted");
  // An ordinary id and an ordinary event key are untouched, so this is a screen and not a blanket.
  assert.equal(
    sanitizeSnapshotId("jihuanshe-tournament-fixture-event-001-0123456789abcdef"),
    "jihuanshe-tournament-fixture-event-001-0123456789abcdef",
  );
  assert.equal(sanitizeEventKey("jihuanshe:tournament:fixture-event-001"), "jihuanshe:tournament:fixture-event-001");
});

test("I1: an ordinary snapshot id passes through the screen unchanged", async (t) => {
  const root = makeRoot(t);
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps());
  assert.equal(result.published.snapshotIds.length, 1);
  assert.equal(`${result.published.snapshotIds[0]}.json`, listSourceFiles(root, "tournaments")[0]);
  assert.match(result.published.snapshotIds[0], /^jihuanshe-tournament-fixture-event-001-[0-9a-f]{16}$/u);
});

test("I2: stdout above the 16 MiB ceiling is refused on BYTE LENGTH, with the truncation flag unset", async (t) => {
  const root = makeRoot(t);
  // A single VALID JSON object padded past the ceiling with trailing whitespace: without an
  // explicit length check this parses, normalizes, and publishes.
  const padded = Buffer.concat([
    bytesOf(batchEnvelope()),
    Buffer.alloc(CHILD_STDOUT_LIMIT_BYTES + 64, 0x20),
  ]);
  assert.ok(padded.length > CHILD_STDOUT_LIMIT_BYTES);
  const deps = makeDeps({ captureChild: () => childOk(padded, { stdoutTruncated: false }) });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.status, "error");
  assert.equal(result.code, "ui_contract_changed");
  assert.equal(result.details.childOutcome, "stdout_too_large");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.deepEqual(deps.calls.publish, []);
  assert.equal(listSourceFiles(root, "tournaments").length, 0);
});

test("I2: stdout exactly at the ceiling is still accepted", async (t) => {
  const root = makeRoot(t);
  const envelope = bytesOf(batchEnvelope());
  const padded = Buffer.concat([envelope, Buffer.alloc(CHILD_STDOUT_LIMIT_BYTES - envelope.length, 0x20)]);
  assert.equal(padded.length, CHILD_STDOUT_LIMIT_BYTES);
  const result = await refreshJiHuanShe(baseOptions(root), realPublishDeps({
    captureChild: () => childOk(padded),
  }));
  assert.equal(result.status, "ok");
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
});

test("I3: an ADB failure opening the login screen is classified and never orphans the AVD it started", async (t) => {
  const root = makeRoot(t);
  const visibleLease = {
    avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 5555,
    processStartToken: "token-visible-started", launchMode: "visible", startedByInvocation: true,
  };
  const deps = makeDeps({
    withAvdLock: async (options, callback) => {
      deps.calls.withAvdLock.push(options);
      return callback({ ...visibleLease });
    },
    launchLoginScreen: () => {
      deps.calls.launchLogin.push(true);
      throw new EnvironmentError("adb_command_failed", "adb_command_failed: am start failed", {});
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);

  assert.equal(result.operation, "reauth");
  assert.equal(result.status, "error");
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.stage, "cleanup");
  assert.equal(result.details.reason, "adb_command_failed");
  assert.equal(refreshExitCode(result), 1);
  // The lifecycle admits what it started, and the visible AVD it started was stopped.
  assert.equal(result.lifecycle.startedByInvocation, true);
  assert.equal(result.lifecycle.launchMode, "visible");
  assert.equal(result.lifecycle.cleanedUp, true);
  assert.deepEqual(deps.calls.cleanupLease, [{ ...visibleLease }]);
});

test("I3: when that cleanup also fails, the orphan is named in the warnings instead of denied", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    withAvdLock: async (options, callback) => {
      deps.calls.withAvdLock.push(options);
      return callback({
        avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 5556,
        processStartToken: "t", launchMode: "visible", startedByInvocation: true,
      });
    },
    launchLoginScreen: () => {
      throw new EnvironmentError("adb_command_failed", "adb_command_failed: nope", {});
    },
    cleanupLease: () => {
      throw new EnvironmentError("lifecycle_timeout", "lifecycle_timeout: nope", {});
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.lifecycle.startedByInvocation, true);
  assert.equal(result.lifecycle.cleanedUp, false);
  assert.ok(result.warnings.includes("visible_avd_left_running"));
});

test("I3: a failure starting the visible AVD is classified and claims nothing was started", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    startAvd: () => {
      deps.calls.startAvd.push("attempted");
      throw new EnvironmentError("avd_spawn_failed", "avd_spawn_failed: no emulator binary", {});
    },
    inspectAvd: () => {
      deps.calls.inspectAvd.push(true);
      return deps.calls.signalProcess.length === 0
        ? { state: "headless-existing", lease: { ...HEADLESS_LEASE } }
        : { state: "offline" };
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.details.reason, "avd_spawn_failed");
  assert.equal(result.lifecycle.startedByInvocation, false);
  assert.deepEqual(deps.calls.cleanupLease, []);
  assert.deepEqual(deps.calls.launchLogin, []);
});

test("I4: an orphaned recovery mutex whose owner is dead does not brick refresh", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  writeFileSync(options.refreshLockPath, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-publication",
    owner: { pid: 999_070, processStartToken: "dead" }, createdAt: "2026-08-20T11:00:00Z",
  })}\n`);
  const mutexPath = `${options.refreshLockPath}.recovery`;
  writeFileSync(mutexPath, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-recovery",
    owner: { pid: 999_071, processStartToken: "dead-too" }, createdAt: "2026-08-20T11:00:00Z",
  })}\n`);

  const result = await refreshJiHuanShe(options, realPublishDeps({ isOwnerAlive: () => false }));
  assert.equal(result.status, "ok");
  assert.equal(existsSync(mutexPath), false);
  assert.equal(existsSync(options.refreshLockPath), false);
});

test("I4: a LIVE recovery mutex still blocks, and status agrees with refresh", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  writeFileSync(options.refreshLockPath, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-publication",
    owner: { pid: 999_080, processStartToken: "dead" }, createdAt: "2026-08-20T11:00:00Z",
  })}\n`);
  const mutexPath = `${options.refreshLockPath}.recovery`;
  writeFileSync(mutexPath, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-recovery",
    owner: { pid: 999_081, processStartToken: "alive" }, createdAt: "2026-08-20T11:00:00Z",
  })}\n`);
  // Only the mutex owner is alive; the primary lock's owner is dead.
  const liveMutexOnly = { isOwnerAlive: (owner) => owner.pid === 999_081 };

  const deps = makeDeps(liveMutexOnly);
  const blocked = await refreshJiHuanShe(options, deps);
  assert.equal(blocked.code, "lock_busy");
  assert.deepEqual(deps.calls.spawns, []);
  assert.equal(existsSync(mutexPath), true);

  const status = await statusJiHuanShe(
    baseOptions(root, { command: "status", target: undefined }),
    makeDeps(liveMutexOnly),
  );
  assert.equal(status.details.refreshLockHeld, true, "status must not report free while refresh reports busy");
  assert.equal(status.details.recoveryPending, true);
});

test("I4: status reports no pending recovery once the mutex is provably stale", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root, { command: "status", target: undefined });
  writeFileSync(`${options.refreshLockPath}.recovery`, `${JSON.stringify({
    schemaVersion: 1, kind: "refresh-recovery",
    owner: { pid: 999_090, processStartToken: "dead" }, createdAt: "2026-08-20T11:00:00Z",
  })}\n`);
  const result = await statusJiHuanShe(options, makeDeps({ isOwnerAlive: () => false }));
  assert.equal(result.details.recoveryPending, false);
  assert.equal(result.details.refreshLockHeld, false);
});

test("I5: a retention directory reached through a symlinked PARENT is refused", async (t) => {
  const root = makeRoot(t);
  const realParent = join(root, "realparent");
  mkdirSync(realParent, { recursive: true });
  symlinkSync(realParent, join(root, "linkparent"));

  const result = await refreshJiHuanShe(
    baseOptions(root, { retainRawDir: join(root, "linkparent", "sub") }),
    realPublishDeps(),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.details.retention.retained, false);
  assert.equal(result.details.retention.reason, "symlink_refused");
  assert.ok(result.warnings.includes("raw_retention_refused"));
  // Nothing was created inside the symlink target.
  assert.deepEqual(readdirSync(realParent), []);
  assert.equal(existsSync(join(root, "linkparent", "sub")), false);
  assert.equal(listSourceFiles(root, "tournaments").length, 1);
});

test("I5: a retention path that is an existing regular file is refused, not written through", async (t) => {
  const root = makeRoot(t);
  const file = join(root, "not-a-directory");
  writeFileSync(file, "occupied");
  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: file }), realPublishDeps());
  assert.equal(result.status, "ok");
  assert.deepEqual(result.details.retention, { retained: false, reason: "not_a_directory" });
  assert.ok(result.warnings.includes("raw_retention_refused"));
  assert.equal(readFileSync(file, "utf8"), "occupied");
});

test("I5: an ordinary nested retention directory is still created and written", async (t) => {
  const root = makeRoot(t);
  const nested = join(root, "diagnostics", "raw");
  const result = await refreshJiHuanShe(baseOptions(root, { retainRawDir: nested }), realPublishDeps());
  assert.deepEqual(result.details.retention, { retained: true, files: 1 });
  assert.equal(lstatSync(nested).mode & 0o777, 0o700);
  assert.equal(readdirSync(nested).length, 1);
});

test("I6: an operation throw is not relabelled as an argument failure", () => {
  const shared = join(tmpdir(), `jihuanshe-refresh-shared-${process.pid}.lock`);
  const run = spawnSync(process.execPath, [
    join(process.cwd(), "tools", "jihuanshe_refresh.mjs"),
    "refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "1",
    "--refresh-lock-path", shared, "--avd-lock-path", shared,
  ], { encoding: "utf8", shell: false, timeout: 30_000 });

  assert.equal(run.status, 1);
  const lines = run.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, run.stdout);
  const result = JSON.parse(lines[0]);
  assert.equal(result.operation, "refresh");
  assert.equal(result.status, "error");
  assert.notEqual(result.stage, "arguments");
  assert.notEqual(result.code, "refresh_input_invalid");
  assert.equal(result.stage, "lock");
  assert.equal(result.code, "lock_busy");
  assert.equal(result.details.reason, "refresh_lock_path_invalid");
  assert.equal(existsSync(shared), false);
});

test("I6: an unprintable result still yields exactly one JSON object and exit 1", () => {
  const good = {
    schemaVersion: 1, source: "jihuanshe", operation: "refresh", status: "ok", stage: "complete", code: "ok",
    lifecycle: { stateBefore: "offline", startedByInvocation: true, launchMode: "headless", cleanedUp: true },
    published: { snapshotIds: [] }, warnings: [],
  };
  const rendered = renderRefreshResult(good);
  assert.equal(rendered.exitCode, 0);
  assert.deepEqual(JSON.parse(rendered.text), good);

  // A result that formatRefreshResult refuses must NOT become an unhandled rejection.
  const broken = renderRefreshResult({ ...good, rawBytes: "leak", code: "made_up" });
  assert.equal(broken.exitCode, 1);
  const fallback = JSON.parse(broken.text);
  assert.equal(broken.text.trimEnd().includes("\n"), false);
  assert.equal(fallback.status, "error");
  assert.equal(fallback.source, "jihuanshe");
  assert.equal(fallback.details.reason, "refresh_result_invalid");
  assert.equal(JSON.stringify(fallback).includes("leak"), false);
  assert.equal(refreshExitCode(fallback), 1);
});

test("M3: --time-zone is validated even when --as-of is supplied", () => {
  assert.throws(
    () => parseArguments([
      "refresh", "tournaments", "--as-of", "2026-08-20", "--window-days", "30", "--time-zone", "Not/AZone",
    ]),
    (error) => error instanceof EnvironmentError && error.code === "refresh_input_invalid",
  );
  assert.throws(
    () => parseArguments(["status", "--time-zone", "Not/AZone"]),
    (error) => error instanceof EnvironmentError && error.code === "refresh_input_invalid",
  );
  assert.equal(
    parseArguments(["refresh", "market", "--time-zone", "Asia/Shanghai"]).timeZone,
    "Asia/Shanghai",
  );
});

test("M5: status reports a corrupt OR foreign-shaped refresh lock as held", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root, { command: "status", target: undefined });
  // Both flavours matter: statusJiHuanShe is a second caller of readRefreshLock, so the
  // "corrupt" sentinel is observable here even though the acquire path's `wx` create would
  // refuse either way.
  for (const contents of [
    "not json at all",
    `${JSON.stringify({ schemaVersion: 1, kind: "avd-drive", owner: { pid: 999_100, processStartToken: "x" } })}\n`,
    `${JSON.stringify({ schemaVersion: 9, kind: "refresh-publication", owner: { pid: 999_101, processStartToken: "x" } })}\n`,
  ]) {
    writeFileSync(options.refreshLockPath, contents);
    const result = await statusJiHuanShe(options, makeDeps({ isOwnerAlive: () => false }));
    assert.equal(result.details.refreshLockHeld, true, contents.slice(0, 40));
    assert.equal(result.details.recoveryPending, false);
  }
});

test("V2: reauth refuses when the live process START TOKEN differs, even at the same pid", async (t) => {
  const root = makeRoot(t);
  const deps = makeDeps({
    inspectAvd: () => {
      deps.calls.inspectAvd.push(true);
      return { state: "headless-existing", lease: { ...HEADLESS_LEASE, processStartToken: "recycled-pid" } };
    },
  });
  const result = await reauthJiHuanShe(baseOptions(root, { command: "reauth", target: undefined }), deps);
  assert.equal(result.code, "cleanup_failed");
  assert.equal(result.details.reason, "avd_identity_unverifiable");
  assert.deepEqual(deps.calls.signalProcess, []);
  assert.deepEqual(deps.calls.startAvd, []);
});

test("V7: the refresh lock is registered on the termination cleanup stack and unregistered after", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const entries = [];
  const cleanupStack = {
    add(callback) {
      const entry = { callback, active: true };
      entries.push(entry);
      return () => {
        entry.active = false;
      };
    },
  };
  const deps = realPublishDeps({
    captureChild: () => {
      // A SIGINT arriving here must release the coordination lock.
      assert.equal(entries.length, 1);
      assert.equal(entries[0].active, true);
      assert.equal(existsSync(options.refreshLockPath), true);
      entries[0].callback();
      assert.equal(existsSync(options.refreshLockPath), false);
      return childOk(batchEnvelope());
    },
  });
  const result = await refreshJiHuanShe({ ...options, cleanupStack }, deps);
  assert.equal(result.status, "ok");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].active, false, "the entry must be unregistered once the refresh returns");
});

test("V8: a mixed-mode refresh all reports the LAST child's launch mode", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps({
    captureChild: (request) => {
      deps.calls.spawns.push(request.argv);
      return request.argv.includes("market")
        ? childOk({
          ...marketEnvelope(),
          lifecycle: {
            state: "visible-existing", launchMode: "visible", startedByInvocation: false, cleanup: { requested: true },
          },
        })
        : childOk(batchEnvelope());
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root, { target: "all" }), deps);
  assert.equal(result.status, "ok");
  assert.equal(result.lifecycle.stateBefore, "offline");
  assert.equal(result.lifecycle.launchMode, "visible");
});

test("V10: a tournament candidate without its event identity is refused at validate", async (t) => {
  const root = makeRoot(t);
  const deps = realPublishDeps({
    normalize: (bytes, context) => {
      const [snapshot] = normalizeJiHuanSheCapture(bytes, context);
      const { snapshotId, contentHash, data, ...rest } = snapshot;
      const { eventEvidenceHash, ...strippedData } = data;
      // Re-finalized, so the envelope and hash are internally consistent: only the event
      // identity requirement can catch this.
      return [finalizeSnapshot({ ...rest, data: strippedData }, "jihuanshe-tournament-stripped")];
    },
  });
  const result = await refreshJiHuanShe(baseOptions(root), deps);
  assert.equal(result.code, "snapshot_validation_failed");
  assert.equal(result.stage, "validate");
  assert.deepEqual(result.published.snapshotIds, []);
  assert.equal(listSourceFiles(root, "tournaments").length, 0);
});

test("V11: the refresh lock file is created 0600 while it is held", async (t) => {
  const root = makeRoot(t);
  const options = baseOptions(root);
  const modes = [];
  const result = await refreshJiHuanShe(options, realPublishDeps({
    captureChild: () => {
      modes.push(lstatSync(options.refreshLockPath).mode & 0o777);
      return childOk(batchEnvelope());
    },
  }));
  assert.equal(result.status, "ok");
  assert.deepEqual(modes, [0o600]);
});
