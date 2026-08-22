import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentError } from "../environment/errors.mjs";
import {
  collectLiveCapabilityInput,
  exportSimulationCapability,
} from "./export_simulation_capability.mjs";

function fakeRunnerFactory() {
  const calls = [];
  const runner = (command, args, options = {}) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (command === "git" && args.includes("rev-parse")) {
      return { status: 0, stdout: "engine-commit-fixture\n", stderr: "" };
    }
    if (command === "git" && args.includes("ls-files")) {
      return {
        status: 0,
        stdout: [
          "submodules/one-piece/packages/cards/src/cards/OP16/001-ace.ts",
          "submodules/one-piece/packages/engine/src/automation/bot-strategies.ts",
        ].join("\n") + "\n",
        stderr: "",
      };
    }
    if (command === "python3") return { status: 0, stdout: "", stderr: "" };
    if (command === "node") {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            printingId: "OP16-001",
            gameplayId: "OP16-001",
            effectText: "[Activate: Main] ...",
            triggerText: null,
            hasStructuredEffects: true,
          },
        ]),
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { calls, runner };
}

test("live capability exporter uses fixed argv and shell:false for every external command", () => {
  const { calls, runner } = fakeRunnerFactory();
  const input = collectLiveCapabilityInput({
    repoRoot: process.cwd(),
    commandRunner: runner,
    readFile: () => Buffer.from("fixture-source"),
    // I7: fake the filesystem-existence seam so this test never depends on vendor/ actually
    // existing on the machine running it (vendor/ is gitignored and absent before bootstrap).
    pathIsDirectory: () => true,
    limitationDefinition: {
      schemaVersion: 1,
      definitionId: "fixture-limitations",
      limitations: [],
    },
    catalogRows: [
      {
        printingId: "OP16-001",
        gameplayId: "OP16-001",
        effectText: "[Activate: Main] ...",
        triggerText: null,
        hasStructuredEffects: true,
      },
    ],
  });

  assert.equal(input.engineRevision, "engine-commit-fixture");
  assert.ok(input.engineWorktreeHash.startsWith("sha256:"));
  assert.ok(calls.some(({ command, args }) => command === "git" && args.join(" ").includes("rev-parse HEAD")));
  const patchCheck = calls.find(({ command, args }) => command === "python3" && args.includes("--check"));
  const engineArg = patchCheck.args[patchCheck.args.indexOf("--engine") + 1];
  assert.equal(engineArg, `${process.cwd()}/vendor/tcg-engines/submodules/one-piece/packages/engine`);
  // Regression guard for the diagnosed defect: patch_engine.py's --engine wants the One Piece
  // ENGINE PACKAGE root (submodules/one-piece/packages/engine), not the vendored repo root
  // (vendor/tcg-engines) that wraps it. Passing the repo root makes every one of its anchor texts
  // unfindable at the wrong relative path, so patch_engine.py reports ALL patches as
  // "could not be applied" even though the real engine state is fully patched -- exactly the
  // engine_patch_mismatch the live smoke saw before this was corrected.
  assert.notEqual(engineArg, `${process.cwd()}/vendor/tcg-engines`);
  assert.ok(calls.every(({ options }) => options.shell === false));
  assert.ok(calls.every(({ args }) => args.every((arg) => typeof arg === "string" && !/[;&|`$()]/.test(arg))));
});

test("exporter refuses an incomplete catalog and never returns a ready snapshot", () => {
  const { runner } = fakeRunnerFactory();
  assert.throws(
    () => exportSimulationCapability({
      repoRoot: process.cwd(),
      commandRunner: runner,
      pathIsDirectory: () => true,
      limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
      catalogRows: [],
    }),
    (error) => error instanceof EnvironmentError && error.code === "catalog_incomplete",
  );
});

test("exporter rejects a failed patch check with a stable code", () => {
  const { runner: baseRunner } = fakeRunnerFactory();
  const runner = (command, args, options) => {
    const result = baseRunner(command, args, options);
    if (command === "python3") return { status: 1, stdout: "", stderr: "patch mismatch" };
    return result;
  };
  assert.throws(
    () => collectLiveCapabilityInput({
      repoRoot: process.cwd(),
      commandRunner: runner,
      pathIsDirectory: () => true,
      limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
      catalogRows: [
        {
          printingId: "OP16-001",
          gameplayId: "OP16-001",
          effectText: null,
          triggerText: null,
          hasStructuredEffects: false,
        },
      ],
    }),
    (error) => error instanceof EnvironmentError && error.code === "engine_patch_mismatch",
  );
});

function manifestProbeRunner(engineFilesList, byteFor) {
  return (command, args) => {
    if (command === "git" && args.includes("rev-parse")) {
      return { status: 0, stdout: "engine-commit-fixture\n", stderr: "" };
    }
    if (command === "git" && args.includes("ls-files") && args.includes("-co")) {
      return { status: 0, stdout: `${engineFilesList.join("\n")}\n`, stderr: "" };
    }
    if (command === "git" && args.includes("ls-files")) {
      return { status: 0, stdout: "cards/OP16/001-ace.ts\n", stderr: "" };
    }
    if (command === "python3") return { status: 0, stdout: "", stderr: "" };
    if (command === "node") {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            printingId: "OP16-001",
            gameplayId: "OP16-001",
            effectText: "[Activate: Main] ...",
            triggerText: null,
            hasStructuredEffects: true,
          },
        ]),
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${command}`);
  };
}

function manifestProbeInput(engineFilesList, byteFor) {
  return collectLiveCapabilityInput({
    repoRoot: process.cwd(),
    commandRunner: manifestProbeRunner(engineFilesList),
    readFile: (path) => Buffer.from(byteFor(path)),
    pathIsDirectory: () => true,
    limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
    catalogRows: [
      {
        printingId: "OP16-001",
        gameplayId: "OP16-001",
        effectText: "[Activate: Main] ...",
        triggerText: null,
        hasStructuredEffects: true,
      },
    ],
  });
}

const MANIFEST_PROBE_CARD_PATH = "submodules/one-piece/packages/cards/src/cards/OP16/001-ace.ts";
const MANIFEST_PROBE_AUTOMATION_PATH = "submodules/one-piece/packages/engine/src/automation/bot-strategies.ts";

test("I2: engine worktree manifest argv, byte sensitivity, and path sensitivity are all load-bearing", () => {
  // (a) the exact `ls-files` argv, including "-co --exclude-standard": dropping either flag would
  // silently switch from cached+modified+untracked-non-ignored to tracked-only, missing grafted
  // card files a plain `git diff HEAD` omits (CLAUDE.md, "engine worktree hash includes cached,
  // modified, and untracked non-ignored gameplay sources").
  const { calls } = (() => {
    const calls = [];
    const runner = (command, args, options = {}) => {
      calls.push({ command, args: [...args] });
      return manifestProbeRunner([MANIFEST_PROBE_CARD_PATH, MANIFEST_PROBE_AUTOMATION_PATH])(command, args, options);
    };
    const input = collectLiveCapabilityInput({
      repoRoot: process.cwd(),
      commandRunner: runner,
      readFile: () => Buffer.from("fixture-bytes"),
      pathIsDirectory: () => true,
      limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
      catalogRows: [
        {
          printingId: "OP16-001",
          gameplayId: "OP16-001",
          effectText: "[Activate: Main] ...",
          triggerText: null,
          hasStructuredEffects: true,
        },
      ],
    });
    return { calls, input };
  })();
  const engineFilesCall = calls.find(({ command, args }) => (
    command === "git" && args.includes("ls-files") && args.includes("-C")
  ));
  assert.ok(engineFilesCall, "expected a git ls-files call for the engine worktree manifest");
  assert.deepEqual(
    engineFilesCall.args.slice(0, 6),
    ["-C", "vendor/tcg-engines", "ls-files", "-co", "--exclude-standard", "--"],
  );

  // (b) per-file bytes feed the hash: same two file paths, different bytes -> different hash.
  const sameFilesDifferentBytesA = manifestProbeInput(
    [MANIFEST_PROBE_CARD_PATH, MANIFEST_PROBE_AUTOMATION_PATH],
    () => "content-A",
  );
  const sameFilesDifferentBytesB = manifestProbeInput(
    [MANIFEST_PROBE_CARD_PATH, MANIFEST_PROBE_AUTOMATION_PATH],
    () => "content-B",
  );
  assert.notEqual(sameFilesDifferentBytesA.engineWorktreeHash, sameFilesDifferentBytesB.engineWorktreeHash);

  // (c) relative paths are part of the manifest identity: same bytes, one file at a different
  // path -> different hash. Both runs read identical content for every file.
  const sameBytesPathA = manifestProbeInput(
    [MANIFEST_PROBE_CARD_PATH, MANIFEST_PROBE_AUTOMATION_PATH],
    () => "identical-content",
  );
  const sameBytesPathB = manifestProbeInput(
    ["submodules/one-piece/packages/cards/src/cards/OP16/001-ace-renamed.ts", MANIFEST_PROBE_AUTOMATION_PATH],
    () => "identical-content",
  );
  assert.notEqual(sameBytesPathA.engineWorktreeHash, sameBytesPathB.engineWorktreeHash);
});

test("I8: two exporter runs over identical engine state produce byte-identical snapshots", () => {
  // A capability snapshot is DERIVED evidence computed from local state, not an acquisition
  // (controller ruling, following the project's Task 5 FieldSnapshot precedent): it must use a
  // deterministic derived source envelope with NO runtime generation timestamp inside the hash.
  // asOf is pinned explicitly here so this test isolates exactly the capturedAt/Date.now() defect,
  // not the coarser (and unflagged) day-boundary question of an omitted --as-of.
  const runOnce = () => exportSimulationCapability({
    repoRoot: process.cwd(),
    commandRunner: manifestProbeRunner([MANIFEST_PROBE_CARD_PATH, MANIFEST_PROBE_AUTOMATION_PATH]),
    readFile: () => Buffer.from("fixture-source"),
    pathIsDirectory: () => true,
    asOf: "2026-08-20",
    limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
    catalogRows: [
      {
        printingId: "OP16-001",
        gameplayId: "OP16-001",
        effectText: "[Activate: Main] ...",
        triggerText: null,
        hasStructuredEffects: true,
      },
    ],
  });
  const first = runOnce();
  const second = runOnce();
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.contentHash, second.contentHash);
});

test("I7: filesystem-existence seam is injectable and fails closed when vendor is missing", () => {
  const { runner } = fakeRunnerFactory();
  // Even though the real vendor/ tree exists on this machine, the exporter must consult the
  // INJECTED seam, not the real filesystem -- otherwise these tests could never run hermetically
  // on a fresh clone before bootstrap, where vendor/ is genuinely absent (it is gitignored).
  // readFile is also faked so the only possible source of a vendor_missing throw is the seam
  // itself, never an incidental real-file-read failure (which would pass for the wrong reason).
  assert.throws(
    () => collectLiveCapabilityInput({
      repoRoot: process.cwd(),
      commandRunner: runner,
      readFile: () => Buffer.from("fixture-source"),
      pathIsDirectory: () => false,
      limitationDefinition: { schemaVersion: 1, definitionId: "fixture-limitations", limitations: [] },
      catalogRows: [
        {
          printingId: "OP16-001",
          gameplayId: "OP16-001",
          effectText: "[Activate: Main] ...",
          triggerText: null,
          hasStructuredEffects: true,
        },
      ],
    }),
    (error) => error instanceof EnvironmentError && error.code === "vendor_missing",
  );
});
