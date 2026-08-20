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
  assert.equal(
    patchCheck.args[patchCheck.args.indexOf("--engine") + 1],
    `${process.cwd()}/vendor/tcg-engines/submodules/one-piece/packages/engine`,
  );
  assert.ok(calls.every(({ options }) => options.shell === false));
  assert.ok(calls.every(({ args }) => args.every((arg) => typeof arg === "string" && !/[;&|`$()]/.test(arg))));
});

test("exporter refuses an incomplete catalog and never returns a ready snapshot", () => {
  const { runner } = fakeRunnerFactory();
  assert.throws(
    () => exportSimulationCapability({
      repoRoot: process.cwd(),
      commandRunner: runner,
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
