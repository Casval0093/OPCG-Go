import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";

import { canonicalJson } from "./canonical.mjs";
import { EnvironmentError } from "./errors.mjs";
import { verifySnapshot } from "./snapshot.mjs";

const TEMP_PATTERN = /^\.([^/]+)\.(\d+)\.([A-Za-z0-9_-]+)\.tmp$/;
const DEFAULT_STALE_AFTER_MS = 60_000;
const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function realProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export const realIo = Object.freeze({
  mkdir: (path, options) => mkdirSync(path, options),
  open: (path, flags, mode) => openSync(path, flags, mode),
  write: (fd, data) => writeSync(fd, data),
  fsync: (fd) => fsyncSync(fd),
  close: (fd) => closeSync(fd),
  link: (source, target) => linkSync(source, target),
  unlink: (path) => unlinkSync(path),
  rename: (source, target) => renameSync(source, target),
  readFile: (path, encoding) => readFileSync(path, encoding),
  readdir: (path) => readdirSync(path),
  stat: (path) => lstatSync(path),
});

function ioWithDefaults(io) {
  return { ...realIo, ...(io ?? {}) };
}

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isAliasPath(target) {
  const parts = resolve(target).split(sep);
  return parts.some((part, index) => part === "data" && parts[index + 1] === "environment-aliases");
}

function canonicalPrettyJson(record) {
  try {
    return `${JSON.stringify(JSON.parse(canonicalJson(record).toString("utf8")), null, 2)}\n`;
  } catch (error) {
    fail("artifact_invalid", "artifact is not serializable JSON data", {
      cause: error?.code ?? error?.message,
    });
  }
}

function cleanupOwnedTemp(io, temp) {
  try {
    io.unlink(temp);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function writeAndSyncTemp(io, temp, content) {
  let fd;
  let owned = false;
  let failure;
  try {
    fd = io.open(temp, "wx", 0o600);
    owned = true;
    const bytes = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const count = io.write(fd, bytes.subarray(offset));
      if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) {
        fail("artifact_write_invalid", "artifact write made invalid progress", {
          count,
          remaining: bytes.length - offset,
        });
      }
      offset += count;
    }
    io.fsync(fd);
  } catch (error) {
    failure = error;
  }
  if (fd !== undefined) {
    try {
      io.close(fd);
    } catch (error) {
      if (failure === undefined) failure = error;
    }
  }
  if (failure !== undefined) {
    failure.tempOwned = owned;
    throw failure;
  }
  return owned;
}

function syncDirectory(io, directory) {
  let fd;
  let failure;
  try {
    fd = io.open(directory, "r");
    io.fsync(fd);
  } catch (error) {
    failure = error;
  }
  if (fd !== undefined) {
    try {
      io.close(fd);
    } catch (error) {
      if (failure === undefined) failure = error;
    }
  }
  if (failure !== undefined) throw failure;
}

function tempPathFor(target) {
  return `${dirname(target)}/.${basename(target)}.${process.pid}.${randomUUID()}.tmp`;
}

function samePublishedHash(existing, artifact) {
  return existing.contentHash === artifact.contentHash;
}

function readExistingEnvelopeHash(io, target) {
  try {
    const value = JSON.parse(io.readFile(target, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { snapshotId: value.snapshotId, contentHash: value.contentHash };
    }
  } catch {
    // The verified-read error below remains authoritative for malformed targets.
  }
  return null;
}

function collisionFromUnverifiedTarget(io, target, artifact) {
  const existing = readExistingEnvelopeHash(io, target);
  if (
    existing?.snapshotId === artifact.snapshotId
    && FULL_HASH_PATTERN.test(existing.contentHash ?? "")
    && existing.contentHash !== artifact.contentHash
  ) {
    return new EnvironmentError(
      "snapshot_id_collision",
      "snapshot_id_collision: target already contains a different immutable snapshot",
      {
        target,
        snapshotId: artifact.snapshotId,
        existingContentHash: existing.contentHash,
        contentHash: artifact.contentHash,
      },
    );
  }
  return null;
}

function publishImmutableAfterTemp({ io, temp, target, artifact }) {
  try {
    io.link(temp, target);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;

    let existing;
    try {
      existing = readVerifiedArtifact(target, io);
    } catch (readError) {
      const collision = collisionFromUnverifiedTarget(io, target, artifact);
      cleanupOwnedTemp(io, temp);
      if (collision) {
        syncDirectory(io, dirname(target));
        throw collision;
      }
      throw readError;
    }
    cleanupOwnedTemp(io, temp);
    syncDirectory(io, dirname(target));
    if (samePublishedHash(existing, artifact)) return existing;
    fail("snapshot_id_collision", "target already contains a different immutable snapshot", {
      target,
      snapshotId: artifact.snapshotId,
      existingContentHash: existing.contentHash,
      contentHash: artifact.contentHash,
    });
  }

  try {
    cleanupOwnedTemp(io, temp);
    syncDirectory(io, dirname(target));
    return artifact;
  } catch (error) {
    // The no-clobber link has already made the target visible. Never remove it
    // as part of publisher-owned temp cleanup.
    try {
      cleanupOwnedTemp(io, temp);
    } catch {
      // Preserve the durability error; the target remains immutable.
    }
    throw error;
  }
}

export function readVerifiedArtifact(path, io = realIo) {
  const resolvedIo = ioWithDefaults(io);
  let stats;
  try {
    stats = resolvedIo.stat(path);
  } catch (error) {
    throw error;
  }
  if (!stats.isFile()) fail("artifact_not_regular", "artifact path is not a regular file", { path });

  let parsed;
  try {
    parsed = JSON.parse(resolvedIo.readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail("artifact_json_invalid", "artifact does not contain valid JSON", {
      path,
      cause: error?.code ?? error?.message,
    });
  }
  return verifySnapshot(parsed);
}

export function publishImmutableArtifact(target, artifact, io = realIo) {
  if (isAliasPath(target)) {
    fail("alias_publication_forbidden", "immutable artifacts cannot be written under data/environment-aliases", {
      target,
    });
  }
  const resolvedIo = ioWithDefaults(io);
  const validatedArtifact = verifySnapshot(artifact);
  const directory = dirname(target);
  const temp = tempPathFor(target);
  resolvedIo.mkdir(directory, { recursive: true, mode: 0o755 });

  let tempOwned = false;
  try {
    tempOwned = writeAndSyncTemp(resolvedIo, temp, canonicalPrettyJson(validatedArtifact));
    return publishImmutableAfterTemp({
      io: resolvedIo,
      temp,
      target,
      artifact: validatedArtifact,
    });
  } catch (error) {
    if (tempOwned || error?.tempOwned) {
      try {
        cleanupOwnedTemp(resolvedIo, temp);
      } catch {
        // Never mask the publication failure with cleanup of our own temp.
      }
    }
    throw error;
  }
}

export function publishMutableRecord(target, record, io = realIo) {
  const resolvedIo = ioWithDefaults(io);
  const directory = dirname(target);
  const temp = tempPathFor(target);
  const content = canonicalPrettyJson(record);
  resolvedIo.mkdir(directory, { recursive: true, mode: 0o755 });

  let tempOwned = false;
  try {
    tempOwned = writeAndSyncTemp(resolvedIo, temp, content);
    resolvedIo.rename(temp, target);
    syncDirectory(resolvedIo, directory);
    return record;
  } catch (error) {
    if (tempOwned || error?.tempOwned) {
      try {
        cleanupOwnedTemp(resolvedIo, temp);
      } catch {
        // Never mask the publication failure with cleanup of our own temp.
      }
    }
    throw error;
  }
}

function recoveryOptions(now, options) {
  const normalizedOptions = typeof options === "function" ? { isPidAlive: options } : options;
  if (now !== null && typeof now === "object" && !(now instanceof Date)) {
    return {
      now: now.now,
      ...now,
      ...(normalizedOptions ?? {}),
    };
  }
  return { now, ...(normalizedOptions ?? {}) };
}

function clockMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "function") return clockMs(value());
  if (value === undefined) return Date.now();
  return Number.NaN;
}

export function recoverStaleTemps(directory, now = Date.now(), options = {}) {
  const configured = recoveryOptions(now, options);
  const nowMs = clockMs(configured.now);
  if (!Number.isFinite(nowMs)) fail("recovery_clock_invalid", "recovery clock must be a valid instant", { now: configured.now });
  const staleAfterMs = configured.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    fail("recovery_age_invalid", "staleAfterMs must be a non-negative finite number", { staleAfterMs });
  }
  const resolvedIo = ioWithDefaults(configured.io);
  const isPidAlive = configured.isPidAlive ?? configured.isProcessAlive ?? realProcessAlive;
  const removed = [];

  for (const entry of resolvedIo.readdir(directory)) {
    const match = TEMP_PATTERN.exec(entry);
    if (!match) continue;
    const pid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    const path = join(directory, entry);
    let stats;
    try {
      stats = resolvedIo.stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile()) continue;
    if (!Number.isFinite(stats.mtimeMs) || nowMs - stats.mtimeMs < staleAfterMs) continue;
    if (isPidAlive(pid)) continue;
    resolvedIo.unlink(path);
    removed.push(path);
  }
  if (removed.length > 0) syncDirectory(resolvedIo, directory);
  return removed;
}

export { TEMP_PATTERN };
