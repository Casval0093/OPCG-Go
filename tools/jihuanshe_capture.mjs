#!/usr/bin/env node
/**
 * Start and drive the owner's JiHuanShe Android emulator without a GUI window.
 *
 * Authentication remains inside the named AVD. This tool reads only rendered
 * UI/WebView content and never inspects app files, cookies, storage, headers,
 * SMS messages, or authentication material.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertUiContext,
  createCleanupStack,
  evaluate,
  extractUiNodes,
  fetchTargets,
  installTerminationHandlers,
  webViewForwardArgs,
} from "./jihuanshe_reader.mjs";

const OWNED_SERIAL = "emulator-5554";
const OWNED_AVD = "JiHuanShe_SC";
const PACKAGE = "com.jihuanshe";
const LAUNCH_ACTIVITY = `${PACKAGE}/com.jihuanshe.ui.page.SplashActivity`;
const TOURNAMENT_INDEX_TARGET = "pages/tournaments/index";
const TOURNAMENT_DETAIL_TARGET = "tournamentPack/pages/detail/detail";
const TARGET_GAME = "航海王简中";
const terminationCleanups = createCleanupStack();

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

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([^\s=]+)="([^"]*)"/gu)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

export function parseUiHierarchy(xml) {
  if (typeof xml !== "string" || !/<hierarchy\b/u.test(xml)) {
    throw new Error("UI XML does not contain a hierarchy root");
  }

  const stack = [];
  let root;
  for (const match of xml.matchAll(/<\/?(?:hierarchy|node)\b[^>]*>/gu)) {
    const token = match[0];
    const closing = token.startsWith("</");
    const name = token.match(/^<\/?(hierarchy|node)\b/u)?.[1];
    if (!name) continue;
    if (closing) {
      if (stack.at(-1)?.tag !== name) throw new Error("Malformed UI XML hierarchy");
      stack.pop();
      continue;
    }

    const attributesSource = token
      .replace(/^<(?:hierarchy|node)\b/u, "")
      .replace(/\/?>$/u, "");
    const element = { tag: name, attributes: parseAttributes(attributesSource), children: [] };
    if (stack.length === 0) {
      if (root) throw new Error("Malformed UI XML: multiple roots");
      root = element;
    } else {
      stack.at(-1).children.push(element);
    }
    if (!/\/\s*>$/u.test(token)) stack.push(element);
  }

  if (!root || root.tag !== "hierarchy" || stack.length !== 0) {
    throw new Error("Malformed UI XML hierarchy");
  }
  return root;
}

function parseBounds(value) {
  const match = String(value).match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u);
  if (!match) throw new Error(`Invalid UI bounds: ${value}`);
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (right <= left || bottom <= top) throw new Error(`Invalid UI bounds: ${value}`);
  return { left, top, width: right - left, height: bottom - top };
}

function attributeLines(node) {
  return [node.attributes.text ?? "", node.attributes["content-desc"] ?? ""]
    .flatMap((value) => value.split(/\r?\n/gu))
    .map((value) => value.trim())
    .filter(Boolean);
}

function uiNodeVisible(node) {
  return node.attributes["visible-to-user"] !== "false"
    && node.attributes.displayed !== "false";
}

function visit(node, ancestors, callback) {
  callback(node, ancestors);
  for (const child of node.children) visit(child, [...ancestors, node], callback);
}

export function findUiTapPoint(xml, label, options = {}) {
  const root = parseUiHierarchy(xml);
  const points = new Map();
  let textMatched = false;
  visit(root, [], (node, ancestors) => {
    if (!uiNodeVisible(node)) return;
    const matched = options.attribute
      ? (options.exactValue
        ? node.attributes[options.attribute] === label
        : String(node.attributes[options.attribute] ?? "").split(/\r?\n/gu)
          .map((value) => value.trim()).includes(label))
      : attributeLines(node).includes(label);
    if (!matched) return;
    textMatched = true;
    const clickable = [node, ...ancestors.toReversed()]
      .find((candidate) => uiNodeVisible(candidate)
        && candidate.attributes.enabled !== "false"
        && candidate.attributes.clickable === "true");
    if (!clickable) return;
    const bounds = parseBounds(clickable.attributes.bounds);
    const point = {
      x: Math.round(bounds.left + (bounds.width / 2)),
      y: Math.round(bounds.top + (bounds.height / 2)),
    };
    points.set(`${point.x},${point.y}`, point);
  });

  if (points.size === 1) return [...points.values()][0];
  if (points.size > 1) throw new Error(`Exact UI label is ambiguous: ${label}`);
  if (textMatched) throw new Error(`UI label has no clickable tap target: ${label}`);
  throw new Error(`Exact UI label not found: ${label}`);
}

export function classifyHomeUi(xml) {
  const labels = new Set();
  visit(parseUiHierarchy(xml), [], (node) => {
    if (!uiNodeVisible(node)) return;
    for (const line of attributeLines(node)) labels.add(line);
  });
  if (labels.has("集换行情") && labels.has("赛事大厅")) return "ready";
  if (["手机号登录", "获取验证码", "验证码登录", "请输入手机号", "登录/注册"]
    .some((label) => labels.has(label))) {
    return "reauth_required";
  }
  return "unknown";
}

export function isTargetMarketUi(xml) {
  let selected = false;
  let marketMarker = false;
  visit(parseUiHierarchy(xml), [], (node) => {
    if (!uiNodeVisible(node)) return;
    if (node.attributes["content-desc"] === "航海王\n简中") selected = true;
    if (attributeLines(node).includes("航海王总行情")) marketMarker = true;
  });
  return selected && marketMarker;
}

export function mapDomPoint(rect, viewport, webViewBounds) {
  const left = rect.left ?? rect.x;
  const top = rect.top ?? rect.y;
  const values = [left, top, rect.width, rect.height, viewport.width, viewport.height,
    webViewBounds.left, webViewBounds.top, webViewBounds.width, webViewBounds.height];
  if (!values.every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0
      || rect.width <= 0 || rect.height <= 0 || webViewBounds.width <= 0
      || webViewBounds.height <= 0) {
    throw new Error("Cannot map invalid DOM or WebView bounds");
  }
  return {
    x: Math.round(webViewBounds.left
      + (((left + (rect.width / 2)) / viewport.width) * webViewBounds.width)),
    y: Math.round(webViewBounds.top
      + (((top + (rect.height / 2)) / viewport.height) * webViewBounds.height)),
  };
}

export function findWebViewBounds(xml) {
  const candidates = [];
  visit(parseUiHierarchy(xml), [], (node) => {
    if (!uiNodeVisible(node)
        || node.attributes.class !== "android.webkit.WebView"
        || !node.attributes.bounds) return;
    const bounds = parseBounds(node.attributes.bounds);
    candidates.push(bounds);
  });
  if (candidates.length === 0) throw new Error("No visible Android WebView bounds found");
  return candidates.toSorted((left, right) => (
    (right.width * right.height) - (left.width * left.height)
  ))[0];
}

export function decodeDomTapTarget(encoded) {
  let target;
  try {
    target = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`DOM target returned invalid JSON: ${error.message}`);
  }
  if (!target || typeof target !== "object" || target.hit !== true) {
    throw new Error("DOM target is covered, stale, or missing");
  }
  const { rect, viewport } = target;
  const left = rect?.left ?? rect?.x;
  const top = rect?.top ?? rect?.y;
  const values = [left, top, rect?.width, rect?.height, viewport?.width, viewport?.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0
      || viewport.width <= 0 || viewport.height <= 0
      || left < 0 || top < 0 || left + rect.width > viewport.width
      || top + rect.height > viewport.height) {
    throw new Error("DOM target is outside the visible viewport bounds");
  }
  return target;
}

function textLines(value) {
  return String(value).split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
}

function requireLines(value, required, description) {
  const lines = new Set(textLines(value));
  if (!required.every((line) => lines.has(line))) {
    throw new Error(`${description} is missing required data`);
  }
}

function hasStandingRows(lines) {
  return lines.some((line) => /^\d{1,2}-\d{1,2}-\d{1,2}$/u.test(line))
    || lines.some((line) => /^(?:\d+(?:st|nd|rd|th)|#\d+)$/u.test(line));
}

function hasDeckRows(lines) {
  return lines.some((line) => /^\d+(?:\.\d+)?%$/u.test(line));
}

export function validateTournamentCapture(capture) {
  const identity = capture?.identity;
  if (!identity?.title || !identity?.startTime || identity.game !== "航海王简中") {
    throw new Error("Tournament identity must specify the 航海王简中 game, title, and start time");
  }
  if (!textLines(capture.detailText).includes(identity.game)) {
    throw new Error("Tournament detail game is not 航海王简中");
  }
  requireLines(
    capture.detailText,
    ["详情", "卡组", "赛果", identity.title, identity.startTime, identity.game, "已结束"],
    "Tournament detail",
  );
  if (capture.results?.activeTab !== "赛果") {
    throw new Error("Tournament results active tab is not 赛果");
  }
  requireLines(
    capture.results.text,
    [identity.title, identity.startTime, identity.game, "选手", "胜平负", "分数"],
    "Tournament results",
  );
  const resultLines = new Set(textLines(capture.results.text));
  if (!["瑞士轮", "淘汰赛"].some((line) => resultLines.has(line))) {
    throw new Error("Tournament results contain no standings data");
  }
  if (!hasStandingRows([...resultLines])) {
    throw new Error("Tournament results contain no standing record rows");
  }
  if (capture.decks?.activeTab !== "卡组") {
    throw new Error("Tournament decks active tab is not 卡组");
  }
  requireLines(
    capture.decks.text,
    [identity.title, identity.startTime, identity.game, "卡组分布", "卡组列表", "选手"],
    "Tournament deck capture",
  );
  if (!hasDeckRows(textLines(capture.decks.text))) {
    throw new Error("Tournament deck capture contains no distribution rows");
  }
}

export function selectLatestCompletedTournament(items) {
  if (!Array.isArray(items)) throw new Error("Tournament items must be an array");
  return items
    .filter((item) => item?.status === "已结束"
      && typeof item.startTime === "string"
      && /^\d{4}-\d{2}-\d{2}\b/u.test(item.startTime))
    .toSorted((left, right) => right.startTime.localeCompare(left.startTime))[0];
}

export function parseReadyDevices(output) {
  return String(output)
    .split(/\r?\n/gu)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

export function parseEmulatorAvdName(output) {
  const lines = String(output)
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && line !== "OK");
  if (lines.length !== 1) throw new Error("Android emulator returned an invalid AVD name");
  return lines[0];
}

export function buildEmulatorArgs({ avd, port }) {
  if (avd !== OWNED_AVD) {
    throw new Error(`This tool owns only AVD ${OWNED_AVD}`);
  }
  if (port !== 5554) {
    throw new Error("This tool owns only emulator port 5554 and serial emulator-5554");
  }
  return [
    "-avd", avd,
    "-port", String(port),
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-no-metrics",
    "-camera-back", "none",
    "-camera-front", "none",
    "-gpu", "auto",
    "-no-snapshot",
  ];
}

export function stopEmulatorArgs(serial) {
  if (serial !== OWNED_SERIAL) {
    throw new Error(`Refusing to stop any serial except ${OWNED_SERIAL}`);
  }
  return ["-s", serial, "emu", "kill"];
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
  const adb = candidates.find(executable);
  if (!adb) throw new Error("adb not found; pass --adb PATH or set ANDROID_SDK_ROOT");
  return adb;
}

function resolveEmulator(explicit) {
  const candidates = [
    explicit,
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "emulator", "emulator"),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "emulator", "emulator"),
    join(homedir(), "Library", "Android", "sdk", "emulator", "emulator"),
  ].filter(Boolean);
  const emulator = candidates.find(executable);
  if (!emulator) throw new Error("Android emulator not found; pass --emulator PATH");
  return emulator;
}

function run(executablePath, args, description, { allowFailure = false, timeout = 20_000 } = {}) {
  const result = spawnSync(executablePath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  if (!allowFailure && result.error) throw new Error(`${description}: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    const reason = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${description}: ${reason}`);
  }
  return result;
}

class ReauthRequiredError extends Error {
  constructor() {
    super("JiHuanShe login has expired");
    this.name = "ReauthRequiredError";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runAdb(adb, args, description, options) {
  return run(adb, ["-s", OWNED_SERIAL, ...args], description, options);
}

async function waitUntil(check, timeoutMs, description, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const result = await check();
      if (result !== undefined && result !== false && result !== null) return result;
    } catch (error) {
      if (error instanceof ReauthRequiredError) throw error;
      lastError = error;
    }
    if (Date.now() < deadline) await delay(intervalMs);
  } while (Date.now() < deadline);
  const suffix = lastError ? `: ${lastError.message}` : "";
  throw new Error(`${description} timed out${suffix}`);
}

function readyDevices(adb) {
  const result = run(adb, ["devices"], "cannot list Android devices", { allowFailure: true });
  if (result.error || result.status !== 0) return [];
  return parseReadyDevices(result.stdout);
}

function bootCompleted(adb) {
  const result = runAdb(
    adb,
    ["shell", "getprop", "sys.boot_completed"],
    "cannot read Android boot state",
    { allowFailure: true },
  );
  return !result.error && result.status === 0 && result.stdout.trim() === "1";
}

function assertOwnedEmulator(adb) {
  const name = parseEmulatorAvdName(
    runAdb(adb, ["emu", "avd", "name"], "cannot identify Android emulator AVD").stdout,
  );
  if (name !== OWNED_AVD) {
    throw new Error(`Refusing emulator ${OWNED_SERIAL}: expected owned AVD ${OWNED_AVD}, found ${name}`);
  }
}

function childIsRunning(child) {
  return child?.exitCode === null && child?.signalCode === null;
}

async function waitForChildExit(child, timeoutMs) {
  if (!childIsRunning(child)) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timeout);
      child.off("exit", finish);
      resolve();
    }
    child.once("exit", finish);
    if (!childIsRunning(child)) finish();
  });
}

async function terminateSpawnedEmulator(child) {
  if (!childIsRunning(child)) return;
  let signalled = false;
  try {
    signalled = child.kill("SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (!signalled) return;
  await waitForChildExit(child, 5_000);
  if (!childIsRunning(child)) return;
  try {
    child.kill("SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await waitForChildExit(child, 1_000);
}

async function ensureEmulator(options) {
  const adb = resolveAdb(options.adb);
  run(adb, ["start-server"], "cannot start adb server");
  let started = false;
  let child;
  let unregisterSpawnCleanup = () => {};
  if (!readyDevices(adb).includes(OWNED_SERIAL)) {
    const emulator = resolveEmulator(options.emulator);
    child = spawn(emulator, buildEmulatorArgs(options), {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT
          ?? join(homedir(), "Library", "Android", "sdk"),
        ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME
          ?? join(homedir(), "Library", "Android", "avd"),
      },
    });
    child.unref();
    unregisterSpawnCleanup = terminationCleanups.add(() => {
      if (!childIsRunning(child)) return;
      try {
        child.kill("SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    });
    started = true;
  }

  try {
    await waitUntil(() => {
      if (!readyDevices(adb).includes(OWNED_SERIAL)) return false;
      return bootCompleted(adb);
    }, options.bootTimeout * 1_000, "Android emulator boot", 250);
    assertOwnedEmulator(adb);
    unregisterSpawnCleanup();
  } catch (error) {
    unregisterSpawnCleanup();
    await terminateSpawnedEmulator(child);
    throw error;
  }
  return { adb, started };
}

function acquireLock() {
  const path = join(tmpdir(), "jihuanshe-capture-emulator-5554.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
      closeSync(descriptor);
      return () => {
        try {
          if (readFileSync(path, "utf8").trim() === String(process.pid)) unlinkSync(path);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let active = true;
      try {
        const owner = Number(readFileSync(path, "utf8").trim());
        if (!Number.isInteger(owner) || owner <= 0) active = false;
        else process.kill(owner, 0);
      } catch (ownerError) {
        if (ownerError.code === "ESRCH" || ownerError.code === "ENOENT") active = false;
        else if (ownerError.code !== "EPERM") throw ownerError;
      }
      if (active) throw new Error("Another JiHuanShe capture is already running");
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("Cannot acquire JiHuanShe capture lock");
}

async function withLock(callback) {
  const release = acquireLock();
  const unregister = terminationCleanups.add(release);
  try {
    return await callback();
  } finally {
    unregister();
    release();
  }
}

function dumpUi(adb) {
  const remote = `/sdcard/jihuanshe-capture-${process.pid}.xml`;
  try {
    runAdb(adb, ["shell", "uiautomator", "dump", remote], "UIAutomator dump failed", {
      timeout: 30_000,
    });
    return runAdb(adb, ["exec-out", "cat", remote], "UIAutomator read failed").stdout;
  } finally {
    runAdb(adb, ["shell", "rm", "-f", remote], "UIAutomator cleanup failed", {
      allowFailure: true,
    });
  }
}

function tap(adb, point) {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) {
    throw new Error("Refusing invalid Android tap point");
  }
  runAdb(adb, ["shell", "input", "tap", String(point.x), String(point.y)], "Android tap failed");
}

function hasUiLine(xml, label) {
  let found = false;
  visit(parseUiHierarchy(xml), [], (node) => {
    if (uiNodeVisible(node) && attributeLines(node).includes(label)) found = true;
  });
  return found;
}

async function waitForUi(adb, predicate, timeoutMs, description) {
  return waitUntil(() => {
    const xml = dumpUi(adb);
    return predicate(xml) ? xml : false;
  }, timeoutMs, description);
}

async function launchHome(adb, timeoutMs) {
  runAdb(adb, ["shell", "input", "keyevent", "KEYCODE_WAKEUP"], "cannot wake emulator", {
    allowFailure: true,
  });
  runAdb(adb, ["shell", "wm", "dismiss-keyguard"], "cannot dismiss keyguard", {
    allowFailure: true,
  });
  runAdb(adb, ["shell", "am", "force-stop", PACKAGE], "cannot stop JiHuanShe");
  runAdb(
    adb,
    ["shell", "am", "start", "-W", "-n", LAUNCH_ACTIVITY],
    "cannot launch JiHuanShe",
    { timeout: 30_000 },
  );
  return waitUntil(() => {
    const xml = dumpUi(adb);
    const state = classifyHomeUi(xml);
    if (state === "reauth_required") throw new ReauthRequiredError();
    return state === "ready" ? xml : false;
  }, timeoutMs, "JiHuanShe home screen");
}

function printEnvelope(surface, data, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    source: "JiHuanShe Android visible UI",
    status: "ok",
    surface,
    capturedAt: new Date().toISOString(),
    ...extra,
    data,
  }, null, 2)}\n`);
}

async function collectMarket(adb, homeXml, options, emulatorStarted) {
  tap(adb, findUiTapPoint(homeXml, "集换行情"));
  let marketXml = await waitForUi(
    adb,
    (xml) => hasUiLine(xml, "总行情"),
    options.homeTimeout * 1_000,
    "JiHuanShe market page",
  );

  if (!isTargetMarketUi(marketXml)) {
    tap(adb, findUiTapPoint(marketXml, "简中"));
    const gameSelectorXml = await waitForUi(adb, (xml) => {
      try {
        findUiTapPoint(xml, "航海王", { attribute: "content-desc", exactValue: true });
        return true;
      } catch {
        return false;
      }
    }, options.homeTimeout * 1_000, "JiHuanShe market game selector");
    tap(adb, findUiTapPoint(
      gameSelectorXml,
      "航海王",
      { attribute: "content-desc", exactValue: true },
    ));
    const languageSelectorXml = await waitForUi(adb, (xml) => {
      try {
        findUiTapPoint(xml, "简中", { attribute: "content-desc", exactValue: true });
        return true;
      } catch {
        return false;
      }
    }, options.homeTimeout * 1_000, "JiHuanShe market language selector");
    tap(adb, findUiTapPoint(
      languageSelectorXml,
      "简中",
      { attribute: "content-desc", exactValue: true },
    ));
    marketXml = await waitForUi(
      adb,
      (xml) => isTargetMarketUi(xml),
      options.homeTimeout * 1_000,
      "航海王简中 market data",
    );
  }

  if (!isTargetMarketUi(marketXml)) {
    throw new Error("Market capture is not the 航海王简中 market");
  }

  const nodes = extractUiNodes(marketXml);
  assertUiContext(nodes, "航海王总行情");
  printEnvelope("market", { nodes }, {
    emulator: {
      serial: OWNED_SERIAL,
      startedByTool: emulatorStarted,
      launchMode: emulatorStarted ? "headless" : "attached_existing",
    },
  });
}

function exactTarget(targets, title) {
  const matches = targets.filter((target) => target.title === title);
  if (matches.length > 1) throw new Error(`Expected one exact WebView target ${title}, found ${matches.length}`);
  return matches[0];
}

async function waitForTarget(port, title, timeoutMs) {
  return waitUntil(async () => exactTarget(await fetchTargets(port), title), timeoutMs, `WebView ${title}`);
}

function forwardWebView(adb, port) {
  const pid = runAdb(adb, ["shell", "pidof", PACKAGE], "JiHuanShe is not running")
    .stdout.trim().split(/\s+/u)[0];
  if (!/^\d+$/u.test(pid)) throw new Error("JiHuanShe process id was not found");
  const socket = `webview_devtools_remote_${pid}`;
  const sockets = runAdb(adb, ["shell", "cat", "/proc/net/unix"], "cannot inspect WebViews").stdout;
  if (!sockets.includes(`@${socket}`)) return false;
  runAdb(
    adb,
    webViewForwardArgs(port, socket),
    "cannot forward JiHuanShe WebView",
  );
  return true;
}

async function openWebViewForward(adb, port, timeoutMs) {
  await waitUntil(() => forwardWebView(adb, port), timeoutMs, "JiHuanShe WebView socket");
}

function removeWebViewForward(adb, port) {
  runAdb(adb, ["forward", "--remove", `tcp:${port}`], "cannot remove WebView forward", {
    allowFailure: true,
  });
}

const PAGE_STATE_EXPRESSION = `(() => JSON.stringify({
  text: document.body ? document.body.innerText : "",
  activeTab: (document.querySelector(".nav_item_active")?.innerText ?? "").trim(),
}))()`;

function domTextTargetExpression(needle, closestSelector) {
  return `(() => {
    const needle = ${JSON.stringify(needle)};
    const candidates = Array.from(document.querySelectorAll("body *")).filter((element) => {
      const text = (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ");
      const rect = element.getBoundingClientRect();
      return text === needle && rect.width > 0 && rect.height > 0;
    });
    candidates.sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return (a.width * a.height) - (b.width * b.height);
    });
    const leaf = candidates[0];
    const target = leaf?.closest(${JSON.stringify(closestSelector)});
    if (!target) return JSON.stringify({ hit: false });
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const hitElement = document.elementFromPoint(centerX, centerY);
    return JSON.stringify({
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hit: Boolean(hitElement && (hitElement === target || target.contains(hitElement))),
    });
  })()`;
}

const TOURNAMENT_ITEMS_EXPRESSION = `(() => JSON.stringify(
  Array.from(document.querySelectorAll("wx-navigator.tour_item,[role=navigation].tour_item"))
    .map((element) => {
      const lines = (element.innerText || element.textContent || "")
        .split(/\\n+/).map((line) => line.trim()).filter(Boolean);
      const status = lines.find((line) => line === "已结束" || line === "进行中" || line === "报名中");
      const startTime = lines.find((line) => /^\\d{4}-\\d{2}-\\d{2}\\b/.test(line));
      const title = lines.find((line) => line !== status && line !== startTime);
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const centerY = rect.top + (rect.height / 2);
      const hitElement = document.elementFromPoint(centerX, centerY);
      return {
        title,
        startTime,
        status,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hit: Boolean(hitElement && (hitElement === element || element.contains(hitElement))),
      };
    })
))()`;

async function evaluateExactTarget(port, title, expression) {
  const target = exactTarget(await fetchTargets(port), title);
  if (!target) throw new Error(`WebView target is missing: ${title}`);
  return evaluate(target, expression, port);
}

async function readPageState(port, title) {
  let state;
  try {
    state = JSON.parse(await evaluateExactTarget(port, title, PAGE_STATE_EXPRESSION));
  } catch (error) {
    throw new Error(`WebView page state is invalid: ${error.message}`);
  }
  if (typeof state?.text !== "string" || typeof state?.activeTab !== "string") {
    throw new Error("WebView page state is malformed");
  }
  return state;
}

async function waitForStablePageState(port, title, predicate, timeoutMs, description) {
  let previous;
  return waitUntil(async () => {
    const state = await readPageState(port, title);
    if (!predicate(state)) {
      previous = undefined;
      return false;
    }
    if (previous?.text === state.text && previous.activeTab === state.activeTab) return state;
    previous = state;
    return false;
  }, timeoutMs, description, 400);
}

async function tapDomText(adb, port, title, needle, closestSelector) {
  const webViewBounds = findWebViewBounds(dumpUi(adb));
  const encoded = await evaluateExactTarget(
    port,
    title,
    domTextTargetExpression(needle, closestSelector),
  );
  let target;
  try {
    target = decodeDomTapTarget(encoded);
  } catch (error) {
    throw new Error(`DOM target ${JSON.stringify(needle)} is unsafe: ${error.message}`);
  }
  tap(adb, mapDomPoint(target.rect, target.viewport, webViewBounds));
}

async function selectTournamentGame(adb, port, options) {
  const initial = await waitForStablePageState(
    port,
    TOURNAMENT_INDEX_TARGET,
    (state) => textLines(state.text).length > 0,
    options.homeTimeout * 1_000,
    "tournament index data",
  );
  if (textLines(initial.text)[0] === TARGET_GAME) return;

  const currentGame = textLines(initial.text)[0];
  if (!currentGame) throw new Error("Tournament game selector has no current game");
  await tapDomText(
    adb,
    port,
    TOURNAMENT_INDEX_TARGET,
    currentGame,
    ".navigation--_sw_item_con",
  );
  await waitUntil(async () => {
    try {
      const encoded = await evaluateExactTarget(
        port,
        TOURNAMENT_INDEX_TARGET,
        domTextTargetExpression(TARGET_GAME, ".navigation--_game_item"),
      );
      decodeDomTapTarget(encoded);
      return true;
    } catch {
      return false;
    }
  }, options.homeTimeout * 1_000, "航海王简中 tournament selector");
  await tapDomText(
    adb,
    port,
    TOURNAMENT_INDEX_TARGET,
    TARGET_GAME,
    ".navigation--_game_item",
  );
  await waitForStablePageState(
    port,
    TOURNAMENT_INDEX_TARGET,
    (state) => textLines(state.text)[0] === TARGET_GAME,
    options.homeTimeout * 1_000,
    "航海王简中 tournament index",
  );
}

async function selectCompletedTournament(adb, port, options) {
  const ready = await waitUntil(async () => {
    const webViewBounds = findWebViewBounds(dumpUi(adb));
    const encoded = await evaluateExactTarget(
      port,
      TOURNAMENT_INDEX_TARGET,
      TOURNAMENT_ITEMS_EXPRESSION,
    );
    let items;
    try {
      items = JSON.parse(encoded);
    } catch (error) {
      throw new Error(`Tournament list returned invalid JSON: ${error.message}`);
    }
    const selected = selectLatestCompletedTournament(items);
    if (!selected?.title || !selected.startTime) return false;
    try {
      return {
        webViewBounds,
        target: decodeDomTapTarget(JSON.stringify({
          ...selected,
          identity: {
            title: selected.title,
            startTime: selected.startTime,
            status: selected.status,
            game: TARGET_GAME,
          },
        })),
      };
    } catch {
      return false;
    }
  }, options.homeTimeout * 1_000, "visible completed 航海王简中 tournament", 400);
  tap(adb, mapDomPoint(ready.target.rect, ready.target.viewport, ready.webViewBounds));
  await waitForTarget(options.devtoolsPort, TOURNAMENT_DETAIL_TARGET, options.homeTimeout * 1_000);
  return ready.target.identity;
}

async function collectTournaments(adb, homeXml, options, emulatorStarted) {
  tap(adb, findUiTapPoint(homeXml, "赛事大厅"));
  await openWebViewForward(adb, options.devtoolsPort, options.homeTimeout * 1_000);
  let forwardOpen = true;
  const closeForward = () => {
    if (!forwardOpen) return;
    forwardOpen = false;
    removeWebViewForward(adb, options.devtoolsPort);
  };
  const unregisterForward = terminationCleanups.add(closeForward);
  try {
    await waitForTarget(
      options.devtoolsPort,
      TOURNAMENT_INDEX_TARGET,
      options.homeTimeout * 1_000,
    );
    await selectTournamentGame(adb, options.devtoolsPort, options);
    const identity = await selectCompletedTournament(adb, options.devtoolsPort, options);
    const detail = await waitForStablePageState(
      options.devtoolsPort,
      TOURNAMENT_DETAIL_TARGET,
      (state) => {
        const lines = textLines(state.text);
        return ["详情", "卡组", "赛果", identity.title, identity.startTime, TARGET_GAME]
          .every((line) => lines.includes(line));
      },
      options.homeTimeout * 1_000,
      "tournament detail",
    );
    await tapDomText(
      adb,
      options.devtoolsPort,
      TOURNAMENT_DETAIL_TARGET,
      "赛果",
      ".nav_item",
    );
    const results = await waitForStablePageState(
      options.devtoolsPort,
      TOURNAMENT_DETAIL_TARGET,
      (state) => state.activeTab === "赛果"
        && textLines(state.text).includes("选手")
        && textLines(state.text).includes("分数")
        && hasStandingRows(textLines(state.text)),
      options.homeTimeout * 1_000,
      "tournament results",
    );
    await tapDomText(
      adb,
      options.devtoolsPort,
      TOURNAMENT_DETAIL_TARGET,
      "卡组",
      ".nav_item",
    );
    const decks = await waitForStablePageState(
      options.devtoolsPort,
      TOURNAMENT_DETAIL_TARGET,
      (state) => state.activeTab === "卡组"
        && textLines(state.text).includes("卡组分布")
        && textLines(state.text).includes("卡组列表")
        && hasDeckRows(textLines(state.text)),
      options.homeTimeout * 1_000,
      "tournament decks",
    );
    const capture = {
      identity,
      detailText: detail.text,
      results: { activeTab: results.activeTab, text: results.text },
      decks: { activeTab: decks.activeTab, text: decks.text },
    };
    validateTournamentCapture(capture);
    printEnvelope("tournament", capture, {
      emulator: {
        serial: OWNED_SERIAL,
        startedByTool: emulatorStarted,
        launchMode: emulatorStarted ? "headless" : "attached_existing",
      },
    });
  } finally {
    unregisterForward();
    closeForward();
  }
}

function parseArguments(argv) {
  const command = argv[0];
  let target;
  let index = 1;
  if (command === "collect") {
    target = argv[1];
    index = 2;
  }
  const options = {
    avd: "JiHuanShe_SC",
    port: 5554,
    devtoolsPort: 9222,
    bootTimeout: 180,
    homeTimeout: 45,
  };
  const names = new Map([
    ["--adb", "adb"],
    ["--emulator", "emulator"],
    ["--avd", "avd"],
    ["--port", "port"],
    ["--devtools-port", "devtoolsPort"],
    ["--boot-timeout", "bootTimeout"],
    ["--home-timeout", "homeTimeout"],
  ]);
  for (; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    const name = names.get(key);
    if (!name || value === undefined) throw new Error(`invalid argument: ${key}`);
    options[name] = value;
    index += 1;
  }
  for (const name of ["port", "devtoolsPort", "bootTimeout", "homeTimeout"]) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  buildEmulatorArgs(options);
  if (options.devtoolsPort < 1024 || options.devtoolsPort > 65535) {
    throw new Error("devtoolsPort must be from 1024 to 65535");
  }
  return { command, target, options };
}

function printStatus(status, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    source: "JiHuanShe Android visible UI",
    status,
    ...extra,
  }, null, 2)}\n`);
}

async function start(options) {
  const { started } = await ensureEmulator(options);
  printStatus("ready", {
    serial: OWNED_SERIAL,
    started,
    launchMode: started ? "headless" : "attached_existing",
  });
}

function status(options) {
  const adb = resolveAdb(options.adb);
  run(adb, ["start-server"], "cannot start adb server");
  const online = readyDevices(adb).includes(OWNED_SERIAL);
  if (online) assertOwnedEmulator(adb);
  const app = online
    ? runAdb(adb, ["shell", "pidof", PACKAGE], "cannot inspect JiHuanShe", {
      allowFailure: true,
    })
    : undefined;
  printStatus(online && bootCompleted(adb) ? "ready" : (online ? "booting" : "offline"), {
    serial: OWNED_SERIAL,
    appRunning: Boolean(app && app.status === 0 && /^\d+/u.test(app.stdout.trim())),
  });
}

async function stop(options) {
  const adb = resolveAdb(options.adb);
  run(adb, ["start-server"], "cannot start adb server");
  if (!readyDevices(adb).includes(OWNED_SERIAL)) {
    printStatus("stopped", { serial: OWNED_SERIAL, alreadyStopped: true });
    return;
  }
  assertOwnedEmulator(adb);
  run(adb, stopEmulatorArgs(OWNED_SERIAL), "cannot stop owned Android emulator");
  await waitUntil(
    () => !readyDevices(adb).includes(OWNED_SERIAL),
    20_000,
    "Android emulator shutdown",
    250,
  );
  printStatus("stopped", { serial: OWNED_SERIAL, alreadyStopped: false });
}

async function collect(target, options) {
  const { adb, started } = await ensureEmulator(options);
  const homeXml = await launchHome(adb, options.homeTimeout * 1_000);
  if (target === "market") {
    await collectMarket(adb, homeXml, options, started);
    return;
  }
  if (target === "tournaments") {
    await collectTournaments(adb, homeXml, options, started);
    return;
  }
  throw new Error("collect target must be market or tournaments");
}

function usage() {
  return `Usage:
  node tools/jihuanshe_capture.mjs collect market [options]
  node tools/jihuanshe_capture.mjs collect tournaments [options]
  node tools/jihuanshe_capture.mjs start [options]
  node tools/jihuanshe_capture.mjs status [--adb PATH]
  node tools/jihuanshe_capture.mjs stop [--adb PATH]
`;
}

async function main() {
  const { command, target, options } = parseArguments(process.argv.slice(2));
  if (command === "status") {
    status(options);
    return;
  }
  if (!["start", "stop", "collect"].includes(command)) throw new Error(usage());
  await withLock(async () => {
    if (command === "start") await start(options);
    else if (command === "stop") await stop(options);
    else await collect(target, options);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const uninstallTerminationHandlers = installTerminationHandlers(process, terminationCleanups);
  main().catch((error) => {
    if (error instanceof ReauthRequiredError) {
      printStatus("reauth_required", { serial: OWNED_SERIAL });
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`jihuanshe_capture: ${error.message}\n`);
    process.exitCode = 1;
  }).finally(uninstallTerminationHandlers);
}
