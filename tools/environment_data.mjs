#!/usr/bin/env node
// Build environment artifacts and resolve an environment.
//
// Every invocation prints EXACTLY ONE sanitized JSON object on stdout and exits
// 0 on success or 1 on failure. Nothing is written to stderr, and no absolute
// filesystem path ever reaches the output. `--now` is defaulted HERE, at the
// command boundary -- the environment library itself never reads host time.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import {
  EnvironmentError,
  buildDeckSnapshot,
  buildFieldSnapshot,
  buildManifest,
  publishImmutableArtifact,
  publishManifest,
  resolveEnvironment,
  resolverErrorJson,
  snapshotRef,
} from "../environment/index.mjs";
import { derivedArtifactPath } from "../environment/alias.mjs";

const COMMANDS = Object.freeze(["build-deck", "build-field", "build-manifest", "resolve"]);

const FLAGS = Object.freeze({
  "build-deck": ["--root", "--input"],
  "build-field": ["--root", "--input"],
  "build-manifest": ["--root", "--input", "--alias", "--now"],
  resolve: [
    "--root",
    "--selector",
    "--manifest-id",
    "--content-hash",
    "--candidate-deck-id",
    "--candidate-deck-hash",
    "--now",
  ],
});
const BOOLEAN_FLAGS = Object.freeze({ resolve: ["--allow-diagnostic"] });

function fail(code, message, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseArguments(argv) {
  const command = argv[0];
  if (!COMMANDS.includes(command)) {
    fail("resolver_input_invalid", "unknown subcommand", { expected: COMMANDS });
  }
  const named = FLAGS[command];
  const booleans = BOOLEAN_FLAGS[command] ?? [];
  const options = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleans.includes(flag)) {
      options[flag.slice(2)] = true;
      continue;
    }
    if (!named.includes(flag)) {
      fail("resolver_input_invalid", "unknown argument", { argument: String(flag).slice(0, 40) });
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      fail("resolver_input_invalid", "argument is missing its value", { argument: flag });
    }
    options[flag.slice(2)] = value;
    index += 1;
  }
  if (typeof options.root !== "string" || options.root.length === 0) {
    fail("resolver_input_invalid", "--root REPOSITORY is required", {});
  }
  if (command !== "resolve" && typeof options.input !== "string") {
    fail("resolver_input_invalid", "--input FILE is required", {});
  }
  return options;
}

// The single caller-named file a command is allowed to read. Repository
// ARTIFACTS are never addressed this way -- they resolve from validated IDs
// under fixed roots.
function readInputFile(path) {
  let text;
  try {
    text = readFileSync(resolvePath(path), "utf8");
  } catch (error) {
    fail("input_unreadable", "the --input file could not be read", { cause: error?.code ?? "unreadable" });
  }
  try {
    const value = JSON.parse(text);
    if (!isRecord(value)) fail("input_invalid", "the --input file must contain a JSON object", {});
    return value;
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail("input_invalid", "the --input file does not contain valid JSON", { cause: "parse_error" });
  }
}

function publishDerived(root, snapshot) {
  publishImmutableArtifact(derivedArtifactPath(root, snapshot.kind, snapshot.snapshotId), snapshot);
  return snapshot;
}

function buildDeckCommand(options) {
  const input = readInputFile(options.input);
  const deck = buildDeckSnapshot(input.deck ?? input, {
    asOf: input.asOf,
    source: input.source,
    idStem: input.idStem,
    coverage: input.coverage,
  });
  publishDerived(options.root, deck);
  return {
    status: "ok",
    command: "build-deck",
    snapshotId: deck.snapshotId,
    contentHash: deck.contentHash,
    gameplayHash: deck.data.gameplayHash,
  };
}

function buildFieldCommand(options) {
  const input = readInputFile(options.input);
  if (!Array.isArray(input.events) || input.events.length === 0) {
    fail("input_invalid", "build-field needs an ordered array of verified event snapshots", {});
  }
  // snapshotRef reverifies every supplied event snapshot, so a tampered event
  // is refused before any artifact is published.
  const sourceRefs = input.events.map((event) => snapshotRef(event));
  const field = buildFieldSnapshot({
    events: input.events,
    identity: input.identity,
    window: input.window,
    sourceRefs,
    selectionPolicy: input.selectionPolicy,
  });
  publishDerived(options.root, field);
  return {
    status: "ok",
    command: "build-field",
    snapshotId: field.snapshotId,
    contentHash: field.contentHash,
    totalParticipants: field.data.totalParticipants,
    selectedEvents: field.data.selectedEvents.length,
  };
}

function buildManifestCommand(options, now) {
  const draft = readInputFile(options.input);
  const manifest = buildManifest(draft, { root: options.root });
  const alias = typeof options.alias === "string" ? options.alias : null;
  publishManifest({ root: options.root, manifest, alias, updatedAt: now });
  return {
    status: "ok",
    command: "build-manifest",
    manifestId: manifest.manifestId,
    contentHash: manifest.contentHash,
    environmentKey: manifest.environmentKey,
    kind: manifest.kind,
    alias,
  };
}

function resolveCommand(options, now) {
  const hasAlias = typeof options.selector === "string";
  const hasDirect = typeof options["manifest-id"] === "string" || typeof options["content-hash"] === "string";
  if (hasAlias === hasDirect) {
    fail("resolver_input_invalid", "supply exactly one of --selector or --manifest-id with --content-hash", {});
  }
  const selector = hasAlias
    ? options.selector
    : { manifestId: options["manifest-id"], contentHash: options["content-hash"] };
  if (typeof options["candidate-deck-id"] !== "string" || typeof options["candidate-deck-hash"] !== "string") {
    fail("resolver_input_invalid", "--candidate-deck-id and --candidate-deck-hash are required", {});
  }
  const resolved = resolveEnvironment(
    {
      selector,
      candidateDeckRef: {
        snapshotId: options["candidate-deck-id"],
        contentHash: options["candidate-deck-hash"],
      },
      now,
      allowDiagnostic: options["allow-diagnostic"] === true,
    },
    { root: options.root },
  );
  return { status: "ok", command: "resolve", resolved };
}

export function runCommand(options, now) {
  if (options.command === "build-deck") return buildDeckCommand(options);
  if (options.command === "build-field") return buildFieldCommand(options);
  if (options.command === "build-manifest") return buildManifestCommand(options, now);
  return resolveCommand(options, now);
}

function errorEnvelope(command, phase, error) {
  const base = resolverErrorJson(error);
  const stamped = isRecord(error?.details) && typeof error.details.stage === "string";
  return {
    status: "error",
    command: command ?? null,
    code: base.code,
    stage: stamped ? base.stage : phase,
    path: base.path,
    details: base.details,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : null;
if (import.meta.url === invokedPath) {
  let options = null;
  try {
    options = parseArguments(process.argv.slice(2));
    // The ONLY place a host clock is read. The library refuses to default it.
    const now = typeof options.now === "string" ? options.now : new Date().toISOString();
    process.stdout.write(`${JSON.stringify(runCommand(options, now))}\n`);
  } catch (error) {
    const phase = options === null ? "arguments" : options.command;
    process.stdout.write(`${JSON.stringify(errorEnvelope(options?.command ?? null, phase, error))}\n`);
    process.exitCode = 1;
  }
}

export { COMMANDS };
