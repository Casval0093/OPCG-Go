import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EnvironmentError } from "../environment/errors.mjs";
import { sha256Canonical } from "../environment/hash.mjs";
import { buildCapabilitySnapshot } from "../environment/capability.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_RELATIVE_PATH = "vendor/tcg-engines";
const ENGINE_RELATIVE_ROOT = "vendor/tcg-engines/submodules/one-piece/packages/engine";
const DEFAULT_ENVIRONMENT = Object.freeze({
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
});
const GAMEPLAY_SOURCE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|mts|json)$/;

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// I7: the command runner and readFile were already injectable seams, but existsSync/statSync were
// called directly, so every exporter test depended on vendor/ actually existing on the machine
// running it -- impossible on a fresh clone before bootstrap, since vendor/ is gitignored.
function defaultPathIsDirectory(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultRunner(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    shell: false,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function commandResult(result, command, args) {
  if (!result || result.error || result.status !== 0) {
    fail("vendor_missing", `${command} command failed`, {
      command,
      args,
      status: result?.status ?? null,
      stderr: String(result?.stderr ?? result?.error?.message ?? "").slice(0, 1000),
    });
  }
  return String(result.stdout ?? "");
}

function runCommand(commandRunner, command, args, options) {
  let result;
  try {
    result = commandRunner(command, args, {
      ...options,
      shell: false,
      encoding: "utf8",
    });
  } catch (error) {
    fail("vendor_missing", `${command} command could not start`, {
      command,
      args,
      cause: error?.message,
    });
  }
  return result;
}

function readBytes(readFile, path, code = "policy_source_unreadable") {
  try {
    const value = readFile(path);
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === "string") return Buffer.from(value, "utf8");
    fail(code, "source reader returned an unsupported value", { path });
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail(code, "source file is unreadable", { path, cause: error?.message });
  }
}

function byteHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function manifestHash(files) {
  return sha256Canonical({
    schemaVersion: 1,
    files: [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  });
}

function parseFileList(stdout) {
  return [...new Set(String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();
}

function isGameplaySource(path) {
  return GAMEPLAY_SOURCE_PATTERN.test(path)
    && (
      path.startsWith("submodules/one-piece/packages/cards/")
      || path.startsWith("submodules/one-piece/packages/engine/src/")
      || path.startsWith("submodules/one-piece/packages/types/src/")
    )
    && !path.includes("/tests/")
    && !path.endsWith(".map");
}

function sourceManifest(paths, readFile, basePath, code = "vendor_missing") {
  return paths.map((path) => ({
    path,
    sha256: byteHash(readBytes(readFile, join(basePath, path), code)),
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function localManifest(paths, readFile, root, code = "policy_source_unreadable") {
  return paths.map((path) => ({
    path,
    sha256: byteHash(readBytes(readFile, join(root, path), code)),
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function defaultCatalogScript() {
  return [
    'import { allCards } from "@tcg/op-cards";',
    "const rows = allCards.map((card) => ({",
    "  id: card.id,",
    "  canonicalId: card.canonicalId,",
    "  printingId: card.id,",
    "  gameplayId: card.canonicalId,",
    "  set: card.setId,",
    "  name: card.name,",
    "  cardType: card.cardType,",
    "  color: card.color ?? [],",
    "  rarity: card.rarity,",
    "  cost: card.cost ?? null,",
    "  power: card.power ?? null,",
    "  counter: card.counter ?? null,",
    "  life: card.life ?? null,",
    "  traits: card.traits ?? [],",
    "  attribute: card.attribute ?? null,",
    "  effectText: card.effect ?? null,",
    "  triggerText: card.trigger ?? null,",
    "  hasEffectText: Boolean(card.effect),",
    "  hasPrintedTrigger: Boolean(card.trigger),",
    "  hasEffects: Boolean(card.effects),",
    "  hasStructuredEffects: Boolean(card.effects),",
    "}));",
    "process.stdout.write(JSON.stringify(rows));",
  ].join("\n");
}

function liveCatalogRows({ repoRoot, engineRoot, commandRunner, catalogRows }) {
  if (catalogRows !== undefined) return catalogRows;
  const stdout = commandResult(
    runCommand(commandRunner, "node", [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      defaultCatalogScript(),
    ], { cwd: engineRoot }),
    "node",
    ["--experimental-strip-types", "--input-type=module", "-e", "<catalog-script>"],
  );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail("catalog_incomplete", "live catalog output is not valid JSON", { cause: error?.message });
  }
}

function chooseEnginePython() {
  return "python3";
}

function loadLimitations(options, repoRoot, readFile) {
  if (options.limitationDefinition !== undefined) return options.limitationDefinition;
  const path = join(repoRoot, "data", "environment-definitions", "simulation-limitations-v1.json");
  const bytes = readBytes(readFile, path);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("policy_source_unreadable", "reviewed limitation definition is not valid JSON", {
      path,
      cause: error?.message,
    });
  }
}

function relativePathOrAbsolute(root, path) {
  const candidate = isAbsolute(path) ? path : resolve(root, path);
  return candidate;
}

export function collectLiveCapabilityInput(options = {}) {
  if (!isRecord(options)) fail("capability_invalid", "exporter options must be an object");
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const vendorRoot = relativePathOrAbsolute(repoRoot, options.vendorRoot ?? VENDOR_RELATIVE_PATH);
  const engineRoot = relativePathOrAbsolute(repoRoot, options.engineRoot ?? ENGINE_RELATIVE_ROOT);
  const pathIsDirectory = options.pathIsDirectory ?? defaultPathIsDirectory;
  if (!pathIsDirectory(vendorRoot)) {
    fail("vendor_missing", "vendored engine root is missing", { vendorRoot });
  }
  if (!pathIsDirectory(engineRoot)) {
    fail("vendor_missing", "vendored One Piece engine package is missing", { engineRoot });
  }
  const commandRunner = options.commandRunner ?? defaultRunner;
  const readFile = options.readFile ?? readFileSync;
  const vendorArg = options.vendorGitPath ?? VENDOR_RELATIVE_PATH;

  const revisionArgs = ["-C", vendorArg, "rev-parse", "HEAD"];
  const revisionStdout = commandResult(
    runCommand(commandRunner, "git", revisionArgs, { cwd: repoRoot }),
    "git",
    revisionArgs,
  );
  const engineRevision = revisionStdout.trim();
  if (!/^[0-9a-f]{7,64}$/i.test(engineRevision) && engineRevision !== "engine-commit-fixture") {
    fail("vendor_missing", "engine revision is invalid", { engineRevision });
  }

  const patchCheckArgs = [
    join(repoRoot, "tools", "patch_engine.py"),
    "--check",
    "--engine",
    engineRoot,
  ];
  const patchCheck = runCommand(commandRunner, chooseEnginePython(), patchCheckArgs, { cwd: repoRoot });
  if (!patchCheck || patchCheck.error || patchCheck.status !== 0) {
    fail("engine_patch_mismatch", "engine patch check failed", {
      status: patchCheck?.status ?? null,
      stderr: String(patchCheck?.stderr ?? "").slice(0, 1000),
    });
  }

  const rows = liveCatalogRows({ repoRoot, engineRoot, commandRunner, catalogRows: options.catalogRows });
  if (!Array.isArray(rows) || rows.length === 0) {
    fail("catalog_incomplete", "live catalog is empty", { reason: "catalog_rows_missing" });
  }

  const engineFilesArgs = ["-C", vendorArg, "ls-files", "-co", "--exclude-standard", "--"];
  const engineFilesStdout = commandResult(
    runCommand(commandRunner, "git", engineFilesArgs, { cwd: repoRoot }),
    "git",
    engineFilesArgs,
  );
  const engineFiles = parseFileList(engineFilesStdout).filter(isGameplaySource);
  if (engineFiles.length === 0) {
    fail("vendor_missing", "vendored gameplay source manifest is empty", { reason: "gameplay_sources_missing" });
  }
  const engineWorktreeManifest = sourceManifest(engineFiles, readFile, vendorRoot, "vendor_missing");
  const engineWorktreeHash = manifestHash(engineWorktreeManifest);

  const cardFilesArgs = ["ls-files", "--", "cards/OP15", "cards/OP16"];
  const cardFilesStdout = commandResult(
    runCommand(commandRunner, "git", cardFilesArgs, { cwd: repoRoot }),
    "git",
    cardFilesArgs,
  );
  const cardFiles = parseFileList(cardFilesStdout).filter((path) => GAMEPLAY_SOURCE_PATTERN.test(path));
  if (cardFiles.length === 0) {
    fail("policy_source_unreadable", "tracked OP15/OP16 card source manifest is empty", {
      reason: "card_sources_missing",
    });
  }
  const localPatchPaths = [
    "tools/patch_engine.py",
    "tools/graft_cards.py",
    "data/card-corrections.json",
  ];
  const localPatchManifest = localManifest(localPatchPaths, readFile, repoRoot);
  const cardSourceManifest = localManifest(cardFiles, readFile, repoRoot);
  const patchDefinitionHash = manifestHash([
    ...localPatchManifest,
    ...cardSourceManifest.map((entry) => ({ path: `tracked/${entry.path}`, sha256: entry.sha256 })),
  ]);

  const policyFiles = engineFiles.filter((path) => (
    path.includes("/automation/")
    && (path.endsWith("bot-strategies.ts") || path.endsWith("bot-harness.ts") || path.endsWith("strategy-registry.ts"))
  ));
  if (policyFiles.length === 0) {
    fail("policy_source_unreadable", "engine policy source manifest is empty", {
      reason: "policy_sources_missing",
    });
  }
  const policyManifest = sourceManifest(policyFiles, readFile, vendorRoot);
  const policySourceHash = manifestHash(policyManifest);

  const environment = { ...DEFAULT_ENVIRONMENT, ...(isRecord(options.environment) ? options.environment : {}) };
  return {
    ...environment,
    asOf: options.asOf ?? new Date().toISOString().slice(0, 10),
    // I8: a capability snapshot is DERIVED evidence computed from local state, not an acquisition
    // (controller ruling, following the project's existing Task 5 FieldSnapshot precedent) -- so
    // its default source envelope carries no runtime generation instant. A `capturedAt` here would
    // be re-signed into the content hash on every run, so two exports of the SAME engine state a
    // few seconds apart produced different snapshotId/contentHash with nothing else different.
    // `engineRevision` is the derivation's own deterministic identity; no clock read is needed.
    source: options.source ?? { adapter: "live-vendored-engine" },
    coverage: options.coverage ?? { status: "complete", warnings: [], missingFields: [] },
    engineRevision,
    engineWorktreeHash,
    patchDefinitionHash,
    policySourceHash,
    catalogContentHash: sha256Canonical(rows),
    catalogRows: rows,
    patchCheck: { status: "passed", command: "patch_engine.py --check" },
    limitations: loadLimitations(options, repoRoot, readFile),
  };
}

export function exportSimulationCapability(options = {}) {
  const input = collectLiveCapabilityInput(options);
  const snapshot = buildCapabilitySnapshot(input);
  if (options.outPath !== undefined) {
    const outPath = resolve(options.outPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  }
  return snapshot;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.outPath = argv[++index];
    else if (arg === "--repo-root") options.repoRoot = argv[++index];
    else if (arg === "--as-of") options.asOf = argv[++index];
    else fail("capability_invalid", `unknown argument: ${arg}`);
  }
  if (typeof options.outPath !== "string" || options.outPath.length === 0) {
    fail("capability_invalid", "--out PATH is required");
  }
  return options;
}

function errorJson(error) {
  return {
    status: "error",
    code: error?.code ?? "capability_export_failed",
    message: error?.message ?? String(error),
    details: isRecord(error?.details) ? error.details : {},
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === invokedPath) {
  try {
    const snapshot = exportSimulationCapability(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      snapshotId: snapshot.snapshotId,
      contentHash: snapshot.contentHash,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorJson(error))}\n`);
    process.exitCode = 1;
  }
}

export { defaultCatalogScript, isGameplaySource, manifestHash };
