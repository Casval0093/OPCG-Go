import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeSnapshot } from "./snapshot.mjs";
import {
  publishImmutableArtifact,
  publishMutableRecord,
  readVerifiedArtifact,
  recoverStaleTemps,
  realIo,
} from "./store.mjs";

const draft = {
  schemaVersion: 1,
  kind: "tournament_event",
  environment: {
    edition: "SC",
    metagameRegion: "CN",
    language: "zh-Hans",
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
  },
  asOf: "2026-08-20",
  source: {
    provider: "jihuanshe",
    surface: "tournament",
    sourceRef: { providerEventId: "example-event-2026-08-20" },
    observedAt: "2026-08-20T19:00:00+08:00",
    capturedAt: "2026-08-20T12:00:00Z",
    captureHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  },
  coverage: { status: "complete", warnings: [], missingFields: [] },
  data: { eventKey: "jihuanshe-example-event-2026-08-20" },
};

function makeSnapshot(eventKey = draft.data.eventKey) {
  return finalizeSnapshot(
    { ...draft, data: { ...draft.data, eventKey } },
    "jihuanshe-tournament-2026-08-20",
  );
}

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), "environment-store-test-"));
}

test("immutable publication is durable, verified, and idempotent", () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "data", "sources", "sc", "tournaments", "snapshot.json");
    const snapshot = makeSnapshot();
    const first = publishImmutableArtifact(target, snapshot);
    const second = publishImmutableArtifact(target, snapshot);

    assert.deepEqual(first, snapshot);
    assert.deepEqual(second, snapshot);
    assert.deepEqual(readVerifiedArtifact(target), snapshot);
    assert.match(readFileSync(target, "utf8"), /\n$/);
    assert.equal(readdirSync(join(root, "data", "sources", "sc", "tournaments")).some(
      (entry) => entry.endsWith(".tmp"),
    ), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("immutable publication refuses a same-ID different full hash", () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "snapshot.json");
    const first = makeSnapshot();
    const conflicting = {
      ...first,
      contentHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    };

    writeFileSync(target, `${JSON.stringify(conflicting)}\n`);
    assert.throws(
      () => publishImmutableArtifact(target, first),
      /snapshot_id_collision/,
    );
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), conflicting);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("injected publication failure leaves target absent and only own temp cleaned", () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "snapshot.json");
    const snapshot = makeSnapshot();
    let tempPath;
    const io = {
      mkdir: (path, options) => mkdirSync(path, options),
      open: (path, flags, mode) => {
        if (flags === "wx") tempPath = path;
        return openSync(path, flags, mode);
      },
      write: () => { throw new Error("injected_write_failure"); },
      fsync: () => {},
      close: (fd) => closeSync(fd),
      link: (source, destination) => linkSync(source, destination),
      unlink: (path) => unlinkSync(path),
      rename: (source, destination) => renameSync(source, destination),
      readFile: (path, encoding) => readFileSync(path, encoding),
      readdir: (path) => readdirSync(path),
      stat: (path) => statSync(path),
    };

    assert.throws(() => publishImmutableArtifact(target, snapshot, io), /injected_write_failure/);
    assert.equal(existsSync(target), false);
    assert.equal(tempPath && existsSync(tempPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("publication loops bounded partial byte writes until the verified payload is complete", () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "partial-write.json");
    const snapshot = finalizeSnapshot(
      { ...draft, data: { ...draft.data, label: "简中" } },
      "jihuanshe-partial-write",
    );
    let writeCalls = 0;
    const io = {
      ...realIo,
      write: (fd, data) => {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const count = Math.max(1, Math.floor(bytes.length / 2));
        writeCalls += 1;
        realIo.write(fd, bytes.subarray(0, count));
        return count;
      },
    };

    publishImmutableArtifact(target, snapshot, io);

    assert.ok(writeCalls > 1);
    assert.deepEqual(readVerifiedArtifact(target), snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid byte-write progress fails closed and cleans its temp", () => {
  const invalidCounts = [0, -1, 1.5, 10_000];
  for (const [index, count] of invalidCounts.entries()) {
    const root = makeTempRoot();
    try {
      const target = join(root, `invalid-write-${index}.json`);
      const snapshot = makeSnapshot(`invalid-write-${index}`);
      const io = {
        ...realIo,
        write: () => count,
      };

      assert.throws(
        () => publishImmutableArtifact(target, snapshot, io),
        /artifact_write_invalid/,
      );
      assert.equal(existsSync(target), false);
      assert.equal(readdirSync(root).some((entry) => entry.endsWith(".tmp")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("immutable publication uses same-directory 0600 temp and durable no-clobber primitives", () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "snapshot.json");
    const snapshot = makeSnapshot();
    const calls = [];
    const io = {
      ...realIo,
      open: (path, flags, mode) => {
        calls.push(["open", path, flags, mode]);
        return realIo.open(path, flags, mode);
      },
      write: (fd, content) => {
        calls.push(["write", Buffer.isBuffer(content), content.toString("utf8").endsWith("\n")]);
        return realIo.write(fd, content);
      },
      fsync: (fd) => {
        calls.push(["fsync", fd]);
        return realIo.fsync(fd);
      },
      close: (fd) => {
        calls.push(["close", fd]);
        return realIo.close(fd);
      },
      link: (source, destination) => {
        calls.push(["link", source, destination]);
        return realIo.link(source, destination);
      },
      unlink: (path) => {
        calls.push(["unlink", path]);
        return realIo.unlink(path);
      },
    };

    publishImmutableArtifact(target, snapshot, io);
    const tempOpen = calls.find((call) => call[0] === "open" && call[2] === "wx");
    assert.ok(tempOpen);
    assert.equal(tempOpen[3], 0o600);
    assert.match(tempOpen[1], new RegExp(`\\.${target.split("/").pop()}\\.${process.pid}\\.[0-9a-f-]+\\.tmp$`));
    assert.equal(calls.some((call) => call[0] === "link" && call[2] === target), true);
    assert.equal(calls.some((call) => call[0] === "rename"), false);
    assert.equal(calls.filter((call) => call[0] === "fsync").length >= 2, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file fsync and mutable rename failures clean only the owned temp", () => {
  const root = makeTempRoot();
  try {
    const immutableTarget = join(root, "immutable.json");
    const mutableTarget = join(root, "alias.json");
    const snapshot = makeSnapshot();
    const failingFsyncIo = {
      ...realIo,
      fsync: () => { throw new Error("injected_fsync_failure"); },
    };
    assert.throws(
      () => publishImmutableArtifact(immutableTarget, snapshot, failingFsyncIo),
      /injected_fsync_failure/,
    );
    assert.equal(existsSync(immutableTarget), false);
    assert.equal(readdirSync(root).some((entry) => entry.endsWith(".tmp")), false);

    const failingRenameIo = {
      ...realIo,
      rename: () => { throw new Error("injected_rename_failure"); },
    };
    assert.throws(
      () => publishMutableRecord(mutableTarget, { alias: "SC/latest" }, failingRenameIo),
      /injected_rename_failure/,
    );
    assert.equal(existsSync(mutableTarget), false);
    assert.equal(readdirSync(root).some((entry) => entry.endsWith(".tmp")), false);

    let fsyncCount = 0;
    const failingDirectoryFsyncIo = {
      ...realIo,
      fsync: (fd) => {
        fsyncCount += 1;
        if (fsyncCount === 2) throw new Error("injected_directory_fsync_failure");
        return realIo.fsync(fd);
      },
    };
    assert.throws(
      () => publishImmutableArtifact(join(root, "directory-fsync.json"), snapshot, failingDirectoryFsyncIo),
      /injected_directory_fsync_failure/,
    );
    assert.deepEqual(readVerifiedArtifact(join(root, "directory-fsync.json")), snapshot);
    assert.equal(readdirSync(root).some((entry) => entry.endsWith(".tmp")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two real publishers never clobber one immutable target", async () => {
  const root = makeTempRoot();
  try {
    const target = join(root, "concurrent.json");
    const first = makeSnapshot("concurrent-first");
    const second = makeSnapshot("concurrent-second");
    const storeUrl = new URL("./store.mjs", import.meta.url).href;
    const childSource = `
      import { publishImmutableArtifact } from ${JSON.stringify(storeUrl)};
      try {
        publishImmutableArtifact(process.argv[1], JSON.parse(process.argv[2]));
      } catch (error) {
        console.error(error.code ?? error.message);
        process.exitCode = 1;
      }
    `;
    const run = (snapshot) => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource, target, JSON.stringify(snapshot)], {
        cwd: new URL("..", import.meta.url),
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => resolve({ status, stderr }));
    });
    const results = await Promise.all([run(first), run(second)]);

    assert.equal(results.filter((result) => result.status === 0).length, 1);
    assert.equal(results.filter((result) => result.status === 1 && result.stderr.includes("snapshot_id_collision")).length, 1);
    const published = readVerifiedArtifact(target);
    assert.equal([first.contentHash, second.contentHash].includes(published.contentHash), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale recovery is exact, PID-aware, and does not touch unfamiliar names", () => {
  const root = makeTempRoot();
  try {
    const stale = join(root, ".snapshot.json.999.deadbeef.tmp");
    const live = join(root, ".snapshot.json.1000.livebeef.tmp");
    const unfamiliar = join(root, ".snapshot.json.999.deadbeef.tmp.bak");
    writeFileSync(stale, "stale");
    writeFileSync(live, "live");
    writeFileSync(unfamiliar, "keep");
    const old = new Date("2026-08-20T00:00:00Z");
    utimesSync(stale, old, old);
    utimesSync(live, old, old);
    utimesSync(unfamiliar, old, old);

    recoverStaleTemps(root, new Date("2026-08-21T00:00:00Z"), {
      staleAfterMs: 60_000,
      isPidAlive: (pid) => pid === 1000,
    });

    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(live), true);
    assert.equal(existsSync(unfamiliar), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("immutable publication rejects the alias namespace while mutable publication replaces it", () => {
  const root = makeTempRoot();
  try {
    const aliasPath = join(root, "data", "environment-aliases", "SC", "latest.json");
    const snapshot = makeSnapshot();
    assert.throws(() => publishImmutableArtifact(aliasPath, snapshot), /alias_publication_forbidden/);
    assert.equal(existsSync(aliasPath), false);
    assert.equal(existsSync(join(root, "data")), false);

    const first = { alias: "SC/latest", manifestId: snapshot.snapshotId, manifestHash: snapshot.contentHash };
    const second = { ...first, updatedAt: "2026-08-21T00:00:00Z" };
    publishMutableRecord(aliasPath, first);
    publishMutableRecord(aliasPath, second);
    assert.deepEqual(JSON.parse(readFileSync(aliasPath, "utf8")), second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
