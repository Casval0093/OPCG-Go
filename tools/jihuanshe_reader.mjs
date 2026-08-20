#!/usr/bin/env node
/**
 * Read data that JiHuanShe renders in an owner-authenticated Android session.
 *
 * The reader is intentionally limited to visible UIAutomator attributes,
 * WebView body text, and AAChartKit series. It does not read cookies, storage,
 * request headers, app files, or authentication material.
 */

import { spawnSync } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = "com.jihuanshe";
const DEFAULT_PORT = 9222;

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/gu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function xmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "u"));
  return match ? decodeXml(match[1]) : "";
}

export function extractUiNodes(xml) {
  if (typeof xml !== "string" || !xml.includes("<hierarchy") || !xml.includes("</hierarchy>")) {
    throw new Error("ADB did not return valid UIAutomator XML");
  }

  const nodes = [];
  for (const match of xml.matchAll(/<node\b([^>]*)\/?\s*>/gu)) {
    if (xmlAttribute(match[1], "visible-to-user") === "false"
        || xmlAttribute(match[1], "displayed") === "false") continue;
    const text = xmlAttribute(match[1], "text");
    const contentDescription = xmlAttribute(match[1], "content-desc");
    if (text || contentDescription) nodes.push({ text, contentDescription });
  }
  return nodes;
}

export function assertUiContext(nodes, marker) {
  const visibleLines = nodes
    .flatMap((node) => [node.text, node.contentDescription])
    .flatMap((value) => value.split(/\r?\n/gu))
    .map((value) => value.trim());
  if (!visibleLines.includes(marker)) {
    throw new Error(`Expected visible marker not found: ${marker}`);
  }
}

export function assertScMarketContext(nodes) {
  assertUiContext(nodes, "航海王总行情");
  if (!nodes.some((node) => node.contentDescription === "航海王\n简中")) {
    throw new Error("Expected visible 航海王简中 market selection was not found");
  }
}

export function assertTournamentText(text) {
  const lines = String(text).split(/\r?\n/gu).map((value) => value.trim());
  const required = ["详情", "卡组", "赛果", "航海王简中"];
  if (!required.every((marker) => lines.includes(marker))) {
    throw new Error("Expected tournament page markers were not found");
  }
}

export function selectTarget(targets, needle) {
  const exact = targets.filter((target) => target.title === needle);
  const matches = exact.length > 0
    ? exact
    : targets.filter((target) => target.title?.includes(needle));
  if (matches.length !== 1) {
    throw new Error(`WebView selector ${JSON.stringify(needle)} matched ${matches.length} WebViews`);
  }
  return matches[0];
}

export function summarizeTarget(target) {
  if (typeof target.url !== "string" || target.url.length === 0) {
    return {
      title: target.title,
      origin: null,
      path: null,
      queryKeys: [],
    };
  }
  const url = new URL(target.url);
  return {
    title: target.title,
    origin: url.origin,
    path: url.pathname,
    queryKeys: [...new Set(url.searchParams.keys())].sort(),
  };
}

export function localWebSocketUrl(value, expectedPort) {
  const url = new URL(value);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("DevTools did not provide a local ws endpoint");
  }
  if (expectedPort !== undefined && Number(url.port) !== expectedPort) {
    throw new Error("DevTools endpoint does not use the forwarded port");
  }
  return url.href;
}

export async function withWebViewForward(open, close, capture) {
  open();
  try {
    return await capture();
  } finally {
    close();
  }
}

export function createCleanupStack() {
  const entries = [];
  return {
    add(cleanup) {
      if (typeof cleanup !== "function") throw new Error("Cleanup callback must be a function");
      const entry = { active: true, cleanup };
      entries.push(entry);
      return () => {
        entry.active = false;
      };
    },
    run() {
      let firstError;
      for (const entry of entries.splice(0).toReversed()) {
        if (!entry.active) continue;
        entry.active = false;
        try {
          entry.cleanup();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    },
  };
}

export function installTerminationHandlers(processObject, cleanupStack) {
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = new Map();
  let handling = false;
  function uninstall() {
    for (const [signal, handler] of handlers) processObject.off(signal, handler);
    handlers.clear();
  }
  for (const signal of signals) {
    const handler = () => {
      if (handling) return;
      handling = true;
      try {
        cleanupStack.run();
      } finally {
        uninstall();
        processObject.kill(processObject.pid, signal);
      }
    };
    handlers.set(signal, handler);
    processObject.once(signal, handler);
  }
  return uninstall;
}

export function decodeRuntimeEvaluation(message) {
  if (message.error) {
    throw new Error(`CDP evaluation failed: ${message.error.message ?? "unknown error"}`);
  }
  if (message.result?.exceptionDetails) {
    const detail = message.result.exceptionDetails.text ?? "JavaScript exception";
    throw new Error(`CDP evaluation failed: ${detail}`);
  }
  if (!("value" in (message.result?.result ?? {}))) {
    throw new Error("CDP evaluation returned no by-value result");
  }
  return message.result.result.value;
}

export function decodeChartEvaluation(encoded) {
  let charts;
  try {
    charts = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`AAChartKit returned invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(charts)) throw new Error("AAChartKit result is not a chart array");
  for (const chart of charts) {
    if (!Array.isArray(chart.categories) || !Array.isArray(chart.series)) {
      throw new Error("AAChartKit chart is missing categories or series");
    }
    for (const series of chart.series) {
      if (typeof series.name !== "string" || !Array.isArray(series.points)) {
        throw new Error("AAChartKit series is malformed");
      }
    }
  }
  const hasPricePoint = charts.some((chart) => chart.series.some(
    (series) => series.points.some((point) => Number.isFinite(point?.y)),
  ));
  if (!hasPricePoint) throw new Error("AAChartKit has no numeric price point");
  return charts;
}

function run(executable, args, description) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
  });
  if (result.error) throw new Error(`${description}: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${description}: ${reason}`);
  }
  return result.stdout;
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAdb(explicit) {
  const candidates = [
    explicit,
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (executable(candidate)) return candidate;
  }

  const fromPath = spawnSync("/usr/bin/which", ["adb"], { encoding: "utf8" });
  const path = fromPath.status === 0 ? fromPath.stdout.trim() : "";
  if (path && executable(path)) return path;
  throw new Error("adb not found; pass --adb PATH or set ANDROID_SDK_ROOT");
}

function adbArgs(serial, args) {
  return serial ? ["-s", serial, ...args] : args;
}

export function webViewForwardArgs(port, socket) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("WebView forward port must be from 1024 to 65535");
  }
  if (!/^webview_devtools_remote_\d+$/u.test(socket)) {
    throw new Error("WebView debugging socket is invalid");
  }
  return ["forward", "--no-rebind", `tcp:${port}`, `localabstract:${socket}`];
}

function runAdb(adb, serial, args, description) {
  return run(adb, adbArgs(serial, args), description);
}

function verifyDevice(adb, serial) {
  if (serial) {
    const state = runAdb(adb, serial, ["get-state"], "cannot reach Android device").trim();
    if (state !== "device") throw new Error(`Android device is not ready: ${state}`);
    return;
  }
  const devices = run(adb, ["devices"], "cannot list Android devices")
    .split(/\r?\n/gu)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && parts[1] === "device");
  if (devices.length !== 1) {
    throw new Error(`expected exactly one ready Android device, found ${devices.length}; pass --serial`);
  }
}

function captureUi(adb, serial, marker) {
  const remote = `/sdcard/jihuanshe-window-${process.pid}.xml`;
  try {
    runAdb(adb, serial, ["shell", "uiautomator", "dump", remote], "UIAutomator dump failed");
    const xml = runAdb(adb, serial, ["exec-out", "cat", remote], "UIAutomator read failed");
    const nodes = extractUiNodes(xml);
    assertUiContext(nodes, marker);
    return nodes;
  } finally {
    runAdb(adb, serial, ["shell", "rm", "-f", remote], "UIAutomator cleanup failed");
  }
}

function forwardWebView(adb, serial, port) {
  const pid = runAdb(adb, serial, ["shell", "pidof", PACKAGE], "JiHuanShe is not running")
    .trim()
    .split(/\s+/u)[0];
  if (!/^\d+$/u.test(pid)) throw new Error("JiHuanShe process id was not found");

  const socket = `webview_devtools_remote_${pid}`;
  const unixSockets = runAdb(adb, serial, ["shell", "cat", "/proc/net/unix"], "cannot inspect WebViews");
  if (!unixSockets.includes(`@${socket}`)) {
    throw new Error("JiHuanShe WebView debugging socket is not available on the current page");
  }
  runAdb(
    adb,
    serial,
    webViewForwardArgs(port, socket),
    "cannot forward WebView debugging socket",
  );
}

export async function fetchTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error("DevTools target list is malformed");
  return targets;
}

export function evaluate(target, expression, port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(localWebSocketUrl(target.webSocketDebuggerUrl, port));
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback(value);
    };
    const timeout = setTimeout(
      () => finish(reject, new Error("CDP evaluation timed out")),
      10_000,
    );

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        finish(reject, new Error(`invalid CDP response: ${error.message}`));
        return;
      }
      if (message.id !== 1) return;
      try {
        finish(resolve, decodeRuntimeEvaluation(message));
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.addEventListener("error", () => finish(reject, new Error("CDP WebSocket failed")));
  });
}

const TOURNAMENT_EXPRESSION = "document.body ? document.body.innerText : ''";
export const CHART_EXPRESSION = `(() => {
  const charts = globalThis.Highcharts?.charts?.filter(Boolean) ?? [];
  return JSON.stringify(charts.map((chart) => {
    const axis = chart.xAxis?.[0];
    const categories = [axis?.categories, axis?.options?.categories, axis?.userOptions?.categories]
      .find((candidate) => Array.isArray(candidate) && candidate.length > 0) ?? [];
    const ticks = (axis?.tickPositions ?? []).map((position) => {
      const label = axis?.ticks?.[position]?.label;
      return {
        x: position,
        label: label?.textStr ?? label?.element?.textContent ?? null,
      };
    });
    return {
      categories,
      axis: {
        min: Number.isFinite(axis?.min) ? axis.min : null,
        max: Number.isFinite(axis?.max) ? axis.max : null,
        ticks,
      },
      series: chart.series.map((series) => ({
        name: series.name,
        points: series.points.map((point) => ({
          x: point.x,
          y: point.y,
          category: point.category ?? null,
          name: point.name ?? null,
        })),
      })),
    };
  }));
})()`;

function parseArguments(argv) {
  const command = argv[0];
  const options = { port: DEFAULT_PORT, target: "tournamentPack/pages/detail/detail" };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--adb", "--serial", "--port", "--target"].includes(key) || value === undefined) {
      throw new Error(`invalid argument: ${key}`);
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error("--port must be an integer from 1024 to 65535");
  }
  return { command, options };
}

function printCapture(surface, data) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    source: "JiHuanShe Android visible UI",
    surface,
    capturedAt: new Date().toISOString(),
    data,
  }, null, 2)}\n`);
}

function usage() {
  return `Usage:
  node tools/jihuanshe_reader.mjs market [--serial ID] [--adb PATH]
  node tools/jihuanshe_reader.mjs card [--serial ID] [--adb PATH]
  node tools/jihuanshe_reader.mjs targets [--serial ID] [--port 9222]
  node tools/jihuanshe_reader.mjs tournament [--target TITLE] [--port 9222]
  node tools/jihuanshe_reader.mjs chart [--port 9222]
`;
}

const terminationCleanups = createCleanupStack();

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!["market", "card", "targets", "tournament", "chart"].includes(command)) {
    throw new Error(usage());
  }

  const adb = resolveAdb(options.adb);
  verifyDevice(adb, options.serial);
  if (command === "market") {
    const nodes = captureUi(adb, options.serial, "航海王总行情");
    assertScMarketContext(nodes);
    printCapture("market", { nodes });
    return;
  }
  if (command === "card") {
    printCapture("card-detail", { nodes: captureUi(adb, options.serial, "集换价") });
    return;
  }

  let forwardOpen = false;
  let unregisterForward = () => {};
  const closeForward = () => {
    if (!forwardOpen) return;
    forwardOpen = false;
    runAdb(
      adb,
      options.serial,
      ["forward", "--remove", `tcp:${options.port}`],
      "cannot remove WebView debugging forward",
    );
  };
  const capture = await withWebViewForward(
    () => {
      forwardWebView(adb, options.serial, options.port);
      forwardOpen = true;
      unregisterForward = terminationCleanups.add(closeForward);
    },
    () => {
      unregisterForward();
      closeForward();
    },
    async () => {
      const targets = await fetchTargets(options.port);
      if (command === "targets") {
        return { surface: "webview-targets", data: { targets: targets.map(summarizeTarget) } };
      }
      if (command === "tournament") {
        const target = selectTarget(targets, options.target);
        const text = await evaluate(target, TOURNAMENT_EXPRESSION, options.port);
        assertTournamentText(text);
        return { surface: "tournament", data: { title: target.title, text } };
      }

      const target = selectTarget(targets, "AAChartKit-Swift");
      const charts = decodeChartEvaluation(
        await evaluate(target, CHART_EXPRESSION, options.port),
      );
      return { surface: "card-price-chart", data: { charts } };
    },
  );
  printCapture(capture.surface, capture.data);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const uninstallTerminationHandlers = installTerminationHandlers(process, terminationCleanups);
  main().catch((error) => {
    process.stderr.write(`jihuanshe_reader: ${error.message}\n`);
    process.exitCode = 1;
  }).finally(uninstallTerminationHandlers);
}
