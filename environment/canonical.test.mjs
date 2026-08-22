import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./canonical.mjs";
import { hashProjection, sha256Canonical } from "./hash.mjs";

const vectors = JSON.parse(readFileSync(
  new URL("../data/hash-vectors/environment-v1.json", import.meta.url),
  "utf8",
)).vectors;
const cliPath = fileURLToPath(new URL("./hash_cli.mjs", import.meta.url));

test("canonical vectors match exact UTF-8 bytes and SHA-256", () => {
  for (const vector of vectors) {
    assert.equal(canonicalJson(vector.input).toString("utf8"), vector.canonical);
    assert.equal(sha256Canonical(vector.input), vector.sha256);
  }
});

test("invalid JSON-domain values and NFC key collisions fail closed", () => {
  assert.throws(() => canonicalJson({ n: Number.NaN }), /canonical_non_finite_number/);
  assert.throws(() => canonicalJson({ missing: undefined }), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson({ callback: () => null }), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson({ marker: Symbol("marker") }), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson(1n), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson(new Date(0)), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson([, 1]), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson({ "é": 1, "é": 2 }), /canonical_key_collision/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /canonical_cycle/);
});

test("lone surrogate code units in values and keys fail closed", () => {
  const high = "\uD800";
  const low = "\uDC00";

  assert.throws(() => canonicalJson(high), /canonical_invalid_unicode/);
  assert.throws(() => canonicalJson(low), /canonical_invalid_unicode/);
  assert.throws(() => canonicalJson({ [high]: 1 }), /canonical_invalid_unicode/);
  assert.throws(() => canonicalJson({ [low]: 1 }), /canonical_invalid_unicode/);
});

test("arrays preserve order and shared references are not mistaken for cycles", () => {
  const shared = { "é": -0 };
  assert.equal(
    canonicalJson([shared, shared]).toString("utf8"),
    "[{\"é\":0},{\"é\":0}]",
  );
});

test("object keys sort by JavaScript UTF-16 code units", () => {
  const astral = "\u{10000}";
  const bmp = "\uE000";
  assert.equal(
    canonicalJson({ [bmp]: 2, [astral]: 1 }).toString("utf8"),
    `{"${astral}":1,"${bmp}":2}`,
  );
});

test("hash projection omits only the named top-level keys", () => {
  const value = { snapshotId: "ignored", contentHash: "ignored", payload: { ok: true } };
  assert.equal(
    hashProjection(value, ["snapshotId", "contentHash"]),
    sha256Canonical({ payload: { ok: true } }),
  );
});

test("hash CLI emits exactly one object for one JSON value", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath],
    { input: "{\"b\":1,\"a\":\"é\"}", encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^\{"sha256":"sha256:[0-9a-f]{64}"\}\n$/);
  assert.deepEqual(JSON.parse(result.stdout), {
    sha256: sha256Canonical({ b: 1, a: "é" }),
  });
});

test("hash CLI accepts exactly 16 MiB and rejects trailing extra input", () => {
  const maxInputBytes = 16 * 1024 * 1024;
  const exactLimit = JSON.stringify("x".repeat(maxInputBytes - 2));
  assert.equal(Buffer.byteLength(exactLimit), maxInputBytes);

  const withinLimit = spawnSync(
    process.execPath,
    [cliPath],
    { input: exactLimit, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(withinLimit.status, 0, withinLimit.stderr);

  const oversized = spawnSync(
    process.execPath,
    [cliPath],
    { input: `${exactLimit} `, encoding: "utf8" },
  );
  assert.notEqual(oversized.status, 0);
  assert.equal(oversized.stdout, "");
  assert.match(oversized.stderr, /hash_input_too_large/);
});

test("hash CLI rejects a second JSON value without writing stdout", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath],
    { input: "{}\n{}", encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /hash_invalid_json/);
});
