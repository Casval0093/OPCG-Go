#!/usr/bin/env node
/**
 * Start and drive the owner's JiHuanShe Android emulator without a GUI window.
 *
 * Authentication remains inside the named AVD. This tool reads only rendered
 * UI/WebView content and never inspects app files, cookies, storage, headers,
 * SMS messages, or authentication material.
 */

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
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
import {
  LifecycleError,
  OWNED_AVD,
  OWNED_PORT,
  OWNED_SERIAL,
  ReauthRequiredError,
  reauthOwnedAvd,
  withAvdDriveLock,
} from "./jihuanshe_lifecycle.mjs";

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
  if (port !== OWNED_PORT) {
    throw new Error(`This tool owns only emulator port ${OWNED_PORT} and serial ${OWNED_SERIAL}`);
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

// Maps this CLI's own --adb/--emulator/--ps/--boot-timeout flags onto the option shape
// tools/jihuanshe_lifecycle.mjs expects. Task 8 delegates ALL AVD process/lock lifecycle to
// that module (startOwnedAvd, cleanupOwnedLease, withAvdDriveLock); this file no longer spawns,
// signals, or locks the emulator directly -- see docs in jihuanshe_lifecycle.mjs for the
// exact-process matching this now guarantees.
function buildLifecycleOptions(options, extra = {}) {
  return {
    adbPath: options.adb,
    emulatorPath: options.emulator,
    psPath: options.ps,
    lockPath: options.lockPath,
    bootTimeoutMs: options.bootTimeout * 1_000,
    bootPollMs: 250,
    cleanupStack: terminationCleanups,
    cleanupStartedOnFinish: options.cleanupStarted === true,
    ...extra,
  };
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
  return reauthOwnedAvd({
    homeTimeoutMs: timeoutMs,
    homePollMs: 500,
    pollHomeState: async () => {
      const xml = dumpUi(adb);
      return { state: classifyHomeUi(xml), value: xml };
    },
  });
}

// Same injectable-seam reasoning as installResultEmitterForTest below: never monkey-patch
// process.stdout.write directly in a test (it races with node --test's own reporter -- see that
// function's comment for the confirmed failure mode).
let legacyEmitter = (envelope) => {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
};

export function installLegacyEmitterForTest(emitter) {
  const previous = legacyEmitter;
  legacyEmitter = emitter;
  return () => {
    legacyEmitter = previous;
  };
}

function printEnvelope(surface, data, extra = {}) {
  legacyEmitter({
    schemaVersion: 1,
    source: "JiHuanShe Android visible UI",
    status: "ok",
    surface,
    capturedAt: new Date().toISOString(),
    ...extra,
    data,
  });
}

async function collectMarket(adb, homeXml, options, lease) {
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
  printCaptureResult(buildCaptureEnvelope({
    surface: "market",
    sourceRef: { sanitizedRoute: "app:market" },
    data: buildTypedMarketData(nodes),
    lifecycle: buildLifecycleMetadata(lease, { requested: options.cleanupStarted === true }),
  }));
}

function exactTarget(targets, title) {
  const matches = targets.filter((target) => target.title === title);
  if (matches.length > 1) throw new Error(`Expected one exact WebView target ${title}, found ${matches.length}`);
  return matches[0];
}

// Injectable fake-CDP seam (fix round 1, reviewer-recommended -- closes S3/S4/S5 structurally).
// `waitForTarget`, `evaluateExactTarget`, and `detailPageProviderEventId` are the ONLY three
// functions that ever call fetchTargets/evaluate directly; every enumeration, tap-and-verify,
// and batch-capture function is built on top of those three, so redirecting just these three
// through an overridable driver makes the WHOLE orchestration layer testable in-process, with no
// real network fetch or WebSocket ever touched. Production default is the real
// jihuanshe_reader.mjs implementations; tests call installCdpDriverForTest(fakeDriver) and MUST
// restore it (via the returned uninstall function) in a try/finally, since it is module-level
// state -- safe here because node --test runs the tests within one file sequentially unless a
// test explicitly opts into concurrency, which none of this file's tests do.
let cdpDriver = { fetchTargets, evaluate };

export function installCdpDriverForTest(driver) {
  const previous = cdpDriver;
  cdpDriver = driver;
  return () => {
    cdpDriver = previous;
  };
}

async function waitForTarget(port, title, timeoutMs) {
  return waitUntil(async () => exactTarget(await cdpDriver.fetchTargets(port), title), timeoutMs, `WebView ${title}`);
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

// Best-effort field extraction only, unverified against a live device (no automated live
// operation is available while authoring this). providerEventId is read from the navigator
// route's own id-shaped query parameter -- never the raw URL itself, which may carry unrelated
// tracking/session parameters -- so a route like ".../detail?id=123&ref=xyz" yields "123" and
// nothing else of the URL survives into the capture. organizer/location use a small set of
// candidate Chinese labels; absent either, the field is simply omitted (both are optional on
// the CaptureResult v2 identity contract).
export const TOURNAMENT_ITEMS_EXPRESSION = `(() => JSON.stringify(
  Array.from(document.querySelectorAll("wx-navigator.tour_item,[role=navigation].tour_item"))
    .map((element) => {
      const lines = (element.innerText || element.textContent || "")
        .split(/\\n+/).map((line) => line.trim()).filter(Boolean);
      const status = lines.find((line) => line === "已结束" || line === "进行中" || line === "报名中");
      const startTime = lines.find((line) => /^\\d{4}-\\d{2}-\\d{2}\\b/.test(line));
      const organizerLine = lines.find((line) => /^(主办方?|组织方?)[:：]/.test(line));
      const locationLine = lines.find((line) => /^(地点|地址)[:：]/.test(line));
      const title = lines.find((line) => line !== status && line !== startTime
        && line !== organizerLine && line !== locationLine);
      const route = element.getAttribute("url") ?? element.getAttribute("href")
        ?? element.dataset?.url;
      const idMatch = typeof route === "string" ? route.match(/[?&](?:id|eventId|tid)=([\\w-]+)/) : null;
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const centerY = rect.top + (rect.height / 2);
      const hitElement = document.elementFromPoint(centerX, centerY);
      return {
        providerEventId: idMatch ? idMatch[1] : undefined,
        title,
        startTime,
        status,
        organizer: organizerLine ? organizerLine.replace(/^(主办方?|组织方?)[:：]/, "").trim() : undefined,
        location: locationLine ? locationLine.replace(/^(地点|地址)[:：]/, "").trim() : undefined,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hit: Boolean(hitElement && (hitElement === element || element.contains(hitElement))),
      };
    })
))()`;

async function evaluateExactTarget(port, title, expression) {
  const target = exactTarget(await cdpDriver.fetchTargets(port), title);
  if (!target) throw new Error(`WebView target is missing: ${title}`);
  return cdpDriver.evaluate(target, expression, port);
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

// ---------------------------------------------------------------------------------------
// Stable tournament selection: pure functions, no ADB/CDP. `item` is whatever the visible
// navigator route extraction (TOURNAMENT_ITEMS_EXPRESSION) or a detail-page revalidation
// produces: { providerEventId?, title, startTime, status?, organizer?, location? }.
// ---------------------------------------------------------------------------------------

// Fixed field order so the hashed fallback object's shape never depends on which optional
// fields happen to be present -- mirrors tools/jihuanshe_normalize.mjs's own eventIdentityOf,
// though this key is independently derived (Task 8 has no import on that frozen module) and
// exists purely to let an operator pick ONE visible index item deterministically.
const FALLBACK_SELECTION_KEY_FIELDS = ["title", "startTime", "organizer", "location"];

export function selectionKeyForTournament(item) {
  if (!item || typeof item !== "object") {
    throw new Error("selectionKeyForTournament requires a tournament item object");
  }
  if (typeof item.providerEventId === "string" && item.providerEventId.length > 0) {
    return `jihuanshe:tournament:${item.providerEventId}`;
  }
  const present = {};
  for (const field of FALLBACK_SELECTION_KEY_FIELDS) {
    if (typeof item[field] === "string" && item[field].length > 0) present[field] = item[field];
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(present, FALLBACK_SELECTION_KEY_FIELDS))
    .digest("hex");
  return `jihuanshe:tournament:fallback:${hash}`;
}

const DEFAULT_ITEM_CEILING = 500;

// Enumerates EVERY completed item (never reduces to the newest, unlike the legacy
// selectLatestCompletedTournament kept below for the backwards-compatible diagnostic), assigns
// each a stable selectionKey, and fails closed rather than guessing when: two visible items
// share one selection key (event_identity_ambiguous), or the completed count exceeds a
// configurable hard ceiling (a failure, never a silent partial result).
export function enumerateCompletedTournaments(items, options = {}) {
  if (!Array.isArray(items)) throw new Error("Tournament items must be an array");
  const ceiling = options.itemCeiling ?? DEFAULT_ITEM_CEILING;
  const completed = items.filter((item) => item?.status === "已结束"
    && typeof item.startTime === "string" && /^\d{4}-\d{2}-\d{2}\b/u.test(item.startTime));
  if (completed.length > ceiling) {
    throw new Error(
      `item_ceiling_exceeded: enumeration found ${completed.length} completed events, over the configured ceiling of ${ceiling}`,
    );
  }
  const withKeys = completed.map((item) => ({ ...item, selectionKey: selectionKeyForTournament(item) }));
  const seen = new Set();
  for (const item of withKeys) {
    if (seen.has(item.selectionKey)) {
      throw new Error(
        `event_identity_ambiguous: two visible completed tournaments share one selection key: ${item.selectionKey}`,
      );
    }
    seen.add(item.selectionKey);
  }
  return withKeys.toSorted((left, right) => (
    right.startTime.localeCompare(left.startTime)
    || left.selectionKey.localeCompare(right.selectionKey)
  ));
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

// Bounds a tournament-batch capture to events completed within windowDays of asOf (inclusive).
// asOf is always the CALLER's explicit, requested date -- never derived from host time here.
export function filterTournamentsWithinWindow(items, asOf, windowDays) {
  if (typeof asOf !== "string" || !LOCAL_DATE_PATTERN.test(asOf)) {
    throw new Error("--as-of must be a local date (YYYY-MM-DD)");
  }
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error("--window-days must be a positive integer");
  }
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const earliestMs = asOfMs - (windowDays * 24 * 60 * 60 * 1000);
  return items.filter((item) => {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(item.startTime ?? "");
    if (!match) return false;
    const itemMs = Date.parse(`${match[1]}T00:00:00Z`);
    return itemMs >= earliestMs && itemMs <= asOfMs;
  });
}

export function selectTournamentByKey(items, key) {
  if (typeof key !== "string" || key.length === 0) throw new Error("--event-key requires a non-empty key");
  const matches = items.filter((item) => (item.selectionKey ?? selectionKeyForTournament(item)) === key);
  if (matches.length === 0) throw new Error(`event_key_not_found: no visible tournament matches key ${key}`);
  if (matches.length > 1) {
    throw new Error(`event_identity_ambiguous: multiple visible tournaments match key ${key}`);
  }
  return matches[0];
}

// Re-derives the selection key from independently-observed detail-page identity (see
// detailPageProviderEventId below) and requires it to match the key the index page produced --
// "verifies that identity again on the detail page," so a stale tap target or a race against a
// re-rendered list cannot silently capture the wrong event.
export function assertSelectedEventIdentity(expectedKey, detailIdentity) {
  const actualKey = selectionKeyForTournament(detailIdentity);
  if (actualKey !== expectedKey) {
    throw new Error(
      `event_identity_mismatch: detail page identity (${actualKey}) does not match the selected event (${expectedKey})`,
    );
  }
  return actualKey;
}

// ---------------------------------------------------------------------------------------
// Typed CaptureResult v2 data assembly -- pure transforms from the SAME raw text/rect shapes
// this file has always scraped (validateTournamentCapture's blob-of-innerText capture, and the
// UIAutomator node list) into the exact typed shape tools/jihuanshe_normalize.mjs (Task 7,
// frozen) requires. UNVERIFIED AGAINST A LIVE DEVICE: the row-boundary assumptions below (a
// fixed number of text lines per row) carry the same "best effort, no live capture available to
// confirm" caveat as the pre-existing blob scraping itself -- see task-8-report.md.
// ---------------------------------------------------------------------------------------

function linesOf(text) {
  return String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

// Results rows: after the "分数" (score) column header, rows repeat as
// [rankLabel, playerName, record, score]. playerName becomes joinToken -- see
// jihuanshe_normalize.mjs's own I4/N1 notes on why a transient, participant-identifying value is
// exactly what that field is for; it is never retained past archetype-joining below.
function parseResultsRows(text) {
  const lines = linesOf(text);
  const headerEnd = lines.lastIndexOf("分数");
  if (headerEnd === -1) throw new Error("results text has no recognizable header (分数)");
  const rowLines = lines.slice(headerEnd + 1);
  if (rowLines.length === 0 || rowLines.length % 4 !== 0) {
    throw new Error(`results row lines (${rowLines.length}) are not a positive multiple of 4`);
  }
  const rows = [];
  for (let i = 0; i < rowLines.length; i += 4) {
    const [rankLabel, player, record, score] = rowLines.slice(i, i + 4);
    const rank = Number.parseInt(rankLabel.replace(/\D/gu, ""), 10);
    if (!Number.isInteger(rank) || rank <= 0) throw new Error(`unrecognized rank label: ${rankLabel}`);
    if (!/^\d+-\d+-\d+$/u.test(record)) throw new Error(`unrecognized record: ${record}`);
    const scoreNumber = Number.parseInt(score, 10);
    if (!Number.isInteger(scoreNumber) || scoreNumber < 0) throw new Error(`unrecognized score: ${score}`);
    rows.push({
      providerRowId: `row-${rank}`, rank, record, score: scoreNumber, joinToken: player,
    });
  }
  return rows;
}

// Deck distribution rows repeat as [archetypeLabel, countLabel, percentageLabel] between the
// "占比" and "卡组列表" markers; entrant rows repeat as [rankLabel, playerName, archetypeLabel]
// after the entrant list's own "选手" column header.
function parseDecksSections(text) {
  const lines = linesOf(text);
  const distStart = lines.indexOf("占比");
  const listMarker = lines.indexOf("卡组列表");
  const entrantHeaderEnd = listMarker === -1 ? -1 : lines.indexOf("选手", listMarker);
  if (distStart === -1 || listMarker === -1 || entrantHeaderEnd === -1) {
    throw new Error("decks text is missing an expected section marker (占比/卡组列表/选手)");
  }
  const distLines = lines.slice(distStart + 1, listMarker);
  if (distLines.length === 0 || distLines.length % 3 !== 0) {
    throw new Error(`deck distribution lines (${distLines.length}) are not a positive multiple of 3`);
  }
  const distributionRows = [];
  for (let i = 0; i < distLines.length; i += 3) {
    const [archetype, countLabel, percentageLabel] = distLines.slice(i, i + 3);
    const count = Number.parseInt(countLabel, 10);
    if (!Number.isInteger(count) || count <= 0) throw new Error(`unrecognized deck count: ${countLabel}`);
    if (!/^\d+(?:\.\d+)?%$/u.test(percentageLabel)) throw new Error(`unrecognized percentage: ${percentageLabel}`);
    distributionRows.push({ rawArchetypeLabel: archetype, count, percentageLabel });
  }

  const entrantLines = lines.slice(entrantHeaderEnd + 1);
  if (entrantLines.length === 0 || entrantLines.length % 3 !== 0) {
    throw new Error(`entrant row lines (${entrantLines.length}) are not a positive multiple of 3`);
  }
  const entrantRows = [];
  for (let i = 0; i < entrantLines.length; i += 3) {
    const [, player, archetype] = entrantLines.slice(i, i + 3);
    entrantRows.push({
      providerRowId: `entrant-${entrantRows.length + 1}`, joinToken: player, rawArchetypeLabel: archetype,
    });
  }
  return { distributionRows, entrantRows };
}

// This project's charter locks the format tracked to Standard, Block 2+ (CLAUDE.md, "Locked
// decisions"); no reliable per-event format label has been found in the current scrape, so this
// is used only when the capture itself carries none -- never silently overriding a real one.
const DEFAULT_FORMAT_LABEL = "标准赛";

export function buildTypedTournamentEventData(capture) {
  const { identity } = capture;
  const resultsRows = parseResultsRows(capture.results.text);
  const { distributionRows, entrantRows } = parseDecksSections(capture.decks.text);

  const archetypeByToken = new Map(entrantRows.map((row) => [row.joinToken, row.rawArchetypeLabel]));
  const typedResultsRows = resultsRows.map((row) => {
    const rawArchetypeLabel = archetypeByToken.get(row.joinToken);
    if (!rawArchetypeLabel) {
      throw new Error(
        `archetype_join_failed: no entrant row matches a results row's player (redacted); rank ${row.rank}`,
      );
    }
    return { ...row, rawArchetypeLabel };
  });

  return {
    identity: {
      title: identity.title,
      game: identity.game,
      status: identity.status,
      startLabel: identity.startTime,
      formatLabel: capture.formatLabel ?? DEFAULT_FORMAT_LABEL,
      ...(capture.participantCountLabel === undefined ? {} : { participantCountLabel: capture.participantCountLabel }),
      ...(identity.organizer === undefined ? {} : { organizerLabel: identity.organizer }),
      ...(identity.location === undefined ? {} : { locationLabel: identity.location }),
    },
    results: { activeTab: capture.results.activeTab, rows: typedResultsRows },
    decks: {
      activeTab: capture.decks.activeTab,
      distributionRows,
      entrantRows,
      ...(capture.sampleFrameLabel === undefined ? {} : { sampleFrameLabel: capture.sampleFrameLabel }),
    },
  };
}

// Market rows: UNVERIFIED AGAINST A LIVE DEVICE, more so than the tournament parsers above --
// no prior task ever scraped market rows into structured fields (only a raw node dump, which
// CaptureResult v2 explicitly forbids). Best effort: a "¥"-prefixed line is a price; the nearest
// preceding non-price line is that row's card label. Throws rather than emitting zero rows.
const CNY_PRICE_LINE_PATTERN = /^¥\d/u;

// F9 (fix round 1): the line immediately preceding a ¥ line was emitted verbatim as
// rawCardLabel with NO shape check at all -- a probe showed a phone-number line and an
// "Authorization: Bearer ..."-shaped line both passed straight through. This is a screen, not a
// parser (per the finding's own instruction): it rejects only OBVIOUS non-card shapes (a hard
// length cap, known-sensitive keywords, phone-number and long-opaque-token shapes) and otherwise
// trusts the label. A rejected row is dropped with a diagnostic (never re-printing the rejected
// text itself, even to this process's own stderr) rather than failing the whole capture; an
// EMPTY result after dropping is still the pre-existing hard failure.
const MAX_CARD_LABEL_LENGTH = 60;
const SENSITIVE_LABEL_PATTERN = /手机号|authorization|bearer\s|password|secret/iu;
const PHONE_NUMBER_LABEL_PATTERN = /1[3-9]\d{9}/u;
const LONG_OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9+/_=-]{24,}$/u;

export function looksLikeMarketCardLabel(label) {
  if (typeof label !== "string" || label.length === 0) return false;
  if (label.length > MAX_CARD_LABEL_LENGTH) return false;
  if (SENSITIVE_LABEL_PATTERN.test(label)) return false;
  if (PHONE_NUMBER_LABEL_PATTERN.test(label)) return false;
  if (LONG_OPAQUE_TOKEN_PATTERN.test(label)) return false;
  return true;
}

export function buildTypedMarketRows(nodes) {
  const lines = nodes
    .flatMap((node) => [node.text, node.contentDescription])
    .flatMap((value) => String(value ?? "").split(/\r?\n/u))
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  let droppedCount = 0;
  let pendingLabel;
  for (const line of lines) {
    if (CNY_PRICE_LINE_PATTERN.test(line)) {
      if (!pendingLabel) continue;
      if (!looksLikeMarketCardLabel(pendingLabel)) {
        droppedCount += 1;
        pendingLabel = undefined;
        continue;
      }
      rows.push({
        providerRowId: `row-${rows.length + 1}`,
        rawCardLabel: pendingLabel,
        observedPriceLabel: line,
      });
      pendingLabel = undefined;
    } else {
      pendingLabel = line;
    }
  }
  if (droppedCount > 0) {
    process.stderr.write(
      `jihuanshe_capture: dropped ${droppedCount} market row(s) whose label failed the card-shape screen\n`,
    );
  }
  if (rows.length === 0) throw new Error("market capture contains no recognizable ¥-priced rows");
  return rows;
}

export function buildTypedMarketData(nodes, query) {
  const rows = buildTypedMarketRows(nodes);
  return {
    identity: { game: TARGET_GAME },
    query: {
      searchLabel: query?.searchLabel || "航海王总行情",
      filterLabels: query?.filterLabels ?? [],
      sortLabel: query?.sortLabel || "默认排序",
    },
    rows,
    // Pinned by the Task 7/8 market contract: visibleRowCount must equal rows.length exactly,
    // and this scraper only ever sees the currently-rendered viewport, never the full listing.
    visibleRowCount: rows.length,
    paginationComplete: false,
  };
}

// ---------------------------------------------------------------------------------------
// CaptureResult v2 envelope assembly. Matches tools/jihuanshe_normalize.mjs's (Task 7, frozen)
// exact envelope allowlist: schemaVersion, source, status, surface, capturedAt, sourceRef, data,
// lifecycle -- nothing else. `lifecycle` carries only the approved state/mode/ownership/cleanup
// fields; Task 7 never reads its contents (it is dropped entirely from every normalized
// snapshot), so its shape is Task 8's own to define.
// ---------------------------------------------------------------------------------------

export function buildLifecycleMetadata(lease, cleanup) {
  return {
    state: `${lease.launchMode}-${lease.startedByInvocation ? "started" : "existing"}`,
    launchMode: lease.launchMode,
    startedByInvocation: lease.startedByInvocation,
    ...(cleanup === undefined ? {} : { cleanup }),
  };
}

export function buildCaptureEnvelope({
  surface, sourceRef, data, lifecycle,
}) {
  return {
    schemaVersion: 2,
    source: "JiHuanShe Android visible UI",
    status: "ok",
    surface,
    capturedAt: new Date().toISOString(),
    sourceRef,
    data,
    lifecycle,
  };
}

// Injectable result-emitter seam (fix round 1): globally monkey-patching process.stdout.write in
// tests to capture what this prints was tried and abandoned -- it raced with node --test's own
// reporter (which also writes through process.stdout), silently swallowing OTHER tests' "#
// Subtest" lines and dropping them from the run's count with no error at all. This mirrors the
// cdpDriver seam instead: tests install their own capture function and never touch the real
// stream.
let resultEmitter = (envelope) => {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
};

export function installResultEmitterForTest(emitter) {
  const previous = resultEmitter;
  resultEmitter = emitter;
  return () => {
    resultEmitter = previous;
  };
}

function printCaptureResult(envelope) {
  resultEmitter(envelope);
}

// Reads the 详情/赛果/卡组 tabs of whichever tournament detail page is CURRENTLY open (the
// caller is responsible for having already navigated there and settled on `identity`), and
// returns the validated blob-of-innerText capture shape this file has always produced. Shared by
// the legacy plural diagnostic and the new singular/batch v2 paths below.
async function captureOpenTournamentDetail(adb, port, options, identity) {
  const detail = await waitForStablePageState(
    port,
    TOURNAMENT_DETAIL_TARGET,
    (state) => {
      const lines = textLines(state.text);
      return ["详情", "卡组", "赛果", identity.title, identity.startTime, TARGET_GAME]
        .every((line) => lines.includes(line));
    },
    options.homeTimeout * 1_000,
    "tournament detail",
  );
  await tapDomText(adb, port, TOURNAMENT_DETAIL_TARGET, "赛果", ".nav_item");
  const results = await waitForStablePageState(
    port,
    TOURNAMENT_DETAIL_TARGET,
    (state) => state.activeTab === "赛果"
      && textLines(state.text).includes("选手")
      && textLines(state.text).includes("分数")
      && hasStandingRows(textLines(state.text)),
    options.homeTimeout * 1_000,
    "tournament results",
  );
  await tapDomText(adb, port, TOURNAMENT_DETAIL_TARGET, "卡组", ".nav_item");
  const decks = await waitForStablePageState(
    port,
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
  return capture;
}

// Opens the tournament index WebView forward, waits for the index target, selects the target
// game, runs `callback`, then always tears the forward back down -- the exact sequence
// collectTournaments always performed, now shared with the new singular/batch capture paths.
async function withTournamentIndexOpen(adb, options, callback) {
  await openWebViewForward(adb, options.devtoolsPort, options.homeTimeout * 1_000);
  let forwardOpen = true;
  const closeForward = () => {
    if (!forwardOpen) return;
    forwardOpen = false;
    removeWebViewForward(adb, options.devtoolsPort);
  };
  const unregisterForward = terminationCleanups.add(closeForward);
  try {
    await waitForTarget(options.devtoolsPort, TOURNAMENT_INDEX_TARGET, options.homeTimeout * 1_000);
    await selectTournamentGame(adb, options.devtoolsPort, options);
    return await callback();
  } finally {
    unregisterForward();
    closeForward();
  }
}

export async function collectTournaments(adb, homeXml, options, lease) {
  tap(adb, findUiTapPoint(homeXml, "赛事大厅"));
  await withTournamentIndexOpen(adb, options, async () => {
    const identity = await selectCompletedTournament(adb, options.devtoolsPort, options);
    const capture = await captureOpenTournamentDetail(adb, options.devtoolsPort, options, identity);
    printEnvelope("tournament", capture, {
      // F10 (fix round 1): restores the EXACT legacy value mapping this backwards-compatible
      // diagnostic always used ("attached_existing" for an adopted AVD, never lease.launchMode's
      // new "headless"/"visible" vocabulary) -- an earlier report claimed this diagnostic was
      // completely unchanged by Task 8, which was inaccurate for this one field; fixed here
      // rather than only in the report, since "backwards-compatible" should mean the value shape
      // too, not just that the command still runs.
      emulator: {
        serial: OWNED_SERIAL,
        startedByTool: lease.startedByInvocation,
        launchMode: lease.startedByInvocation ? "headless" : "attached_existing",
      },
    });
  });
}

// ---------------------------------------------------------------------------------------
// Scroll-to-load enumeration, stable event selection by key, and revalidation on the detail
// page. UNVERIFIED AGAINST A LIVE DEVICE (see the typed-data-assembly section above for the same
// caveat on the row parsers): the scroll trigger below is a best-effort, generic "scroll window
// and every overflowing container" probe, not a selector confirmed against the real index page.
// ---------------------------------------------------------------------------------------

const SCROLL_STEP_EXPRESSION = `(() => {
  window.scrollBy(0, window.innerHeight);
  Array.from(document.querySelectorAll("*")).forEach((element) => {
    if (element.scrollHeight > element.clientHeight + 4) element.scrollTop += element.clientHeight;
  });
  return true;
})()`;

// Reads the visible tournament index items, scrolling to load more, until the set of ALL visible
// items (not just completed ones -- see F5 below) is unchanged across two consecutive reads.
// options.itemCeiling remains a hard failure via enumerateCompletedTournaments, enforced every
// round.
//
// F5 (fix round 1): two problems in the pre-fix version, both capable of returning a silent
// partial result labelled as a clean success.
// (1) Cap (maxScrolls) exhaustion without ever seeing two identical reads fell through to a
//     normal `return items` using whatever the LAST round happened to see -- exactly the
//     forbidden "silent partial" outcome. Fixed: exhausting the cap without stabilizing is now a
//     hard failure, `enumeration_did_not_stabilize`.
// (2) The stability signature was computed over enumerateCompletedTournaments's output --
//     COMPLETED items only. A scroll that has stopped revealing new completed events but is
//     still loading additional 进行中/报名中 rows underneath would read as "stable" even though
//     the page has not finished loading, and a completed event further down could still be
//     waiting to render. Fixed: the signature now covers every visible item regardless of status.
// A page-side "end of list" DOM signal (per the controller's ruling, implement it if derivable)
// was considered for this fix: TOURNAMENT_ITEMS_EXPRESSION extracts only per-item fields today
// and has no marker for a "no more results" footer/disabled-load-more state, and there is no live
// device available to discover what such a marker looks like in this app. That signal is
// therefore NOT implemented; cap-exhaustion-is-a-failure is the enforcement mechanism instead,
// exactly as the ruling permits when the DOM shape does not expose one.
export async function enumerateVisibleTournamentIndexItems(port, options) {
  const maxScrolls = options.maxScrolls ?? 40;
  let previousSignature = null;
  let completedItems = [];
  let stabilized = false;
  for (let round = 0; round <= maxScrolls; round += 1) {
    const encoded = await evaluateExactTarget(port, TOURNAMENT_INDEX_TARGET, TOURNAMENT_ITEMS_EXPRESSION);
    let rawItems;
    try {
      rawItems = JSON.parse(encoded);
    } catch (error) {
      throw new Error(`Tournament list returned invalid JSON: ${error.message}`);
    }
    if (!Array.isArray(rawItems)) throw new Error("Tournament list returned a non-array result");

    completedItems = enumerateCompletedTournaments(rawItems, { itemCeiling: options.itemCeiling });
    const allVisibleSignature = rawItems
      .map((item) => (typeof item?.providerEventId === "string" && item.providerEventId.length > 0
        ? `id:${item.providerEventId}`
        : `t:${item?.title ?? ""}|${item?.startTime ?? ""}|${item?.status ?? ""}`))
      .toSorted()
      .join("|");
    if (previousSignature !== null && allVisibleSignature === previousSignature) {
      stabilized = true;
      break;
    }
    previousSignature = allVisibleSignature;
    if (round < maxScrolls) {
      await evaluateExactTarget(port, TOURNAMENT_INDEX_TARGET, SCROLL_STEP_EXPRESSION);
      await delay(300);
    }
  }
  if (!stabilized) {
    throw new Error(
      `enumeration_did_not_stabilize: the tournament index did not stop growing within ${maxScrolls} scroll(s)`,
    );
  }
  return completedItems;
}

function rectWithinViewport(rect, viewport) {
  if (!rect || !viewport) return false;
  const { left, top, width, height } = rect;
  return [left, top, width, height, viewport.width, viewport.height].every(Number.isFinite)
    && left >= 0 && top >= 0
    && left + width <= viewport.width && top + height <= viewport.height;
}

// Viewport-reachability (fix round 2, controller ruling): a freshly (re-)enumerated item's rect
// can legitimately fall OUTSIDE the current viewport -- KEYCODE_BACK resets scroll position, but
// the enumeration that follows it can still report a rect from further down the (now
// scrolled-away-from) list. decodeDomTapTarget would throw "outside the visible viewport bounds"
// in that case. This scrolls the index into position for THIS ONE item -- reusing the same
// SCROLL_STEP_EXPRESSION trigger enumeration itself uses -- and re-reads just its current
// position each round, bounded by the same maxScrolls discipline as enumeration; it fails closed
// (never taps) if the item is never reachable within that budget, or if it disappears entirely
// while scrolling (event_key_not_found, matching enumerateVisibleTournamentIndexItems's own
// vanished-item vocabulary).
async function scrollSelectedItemIntoView(port, options, key, currentItem) {
  if (rectWithinViewport(currentItem.rect, currentItem.viewport)) return currentItem;
  const maxScrolls = options.maxScrolls ?? 40;
  let item = currentItem;
  for (let round = 0; round < maxScrolls; round += 1) {
    await evaluateExactTarget(port, TOURNAMENT_INDEX_TARGET, SCROLL_STEP_EXPRESSION);
    await delay(300);
    const encoded = await evaluateExactTarget(port, TOURNAMENT_INDEX_TARGET, TOURNAMENT_ITEMS_EXPRESSION);
    let rawItems;
    try {
      rawItems = JSON.parse(encoded);
    } catch (error) {
      throw new Error(`Tournament list returned invalid JSON: ${error.message}`);
    }
    if (!Array.isArray(rawItems)) throw new Error("Tournament list returned a non-array result");
    const found = rawItems.find((candidate) => selectionKeyForTournament(candidate) === key);
    if (!found) {
      throw new Error(
        `event_key_not_found: selected event ${key} disappeared from the tournament index while scrolling it into view`,
      );
    }
    item = found;
    if (rectWithinViewport(item.rect, item.viewport)) return item;
  }
  throw new Error(
    `event_unreachable: selected event ${key} could not be scrolled into the visible viewport within ${maxScrolls} scroll(s)`,
  );
}

// The detail page's OWN WebView route, read independently of whatever the index page's
// navigator element claimed, so a stale tap target or a re-rendered list cannot silently pass
// revalidation just because the SAME object was echoed back.
async function detailPageProviderEventId(port) {
  const target = exactTarget(await cdpDriver.fetchTargets(port), TOURNAMENT_DETAIL_TARGET);
  const match = /[?&](?:id|eventId|tid)=([\w-]+)/u.exec(target?.url ?? "");
  return match ? match[1] : undefined;
}

// F3 (fix round 1): two independent problems in the pre-fix version.
// (1) It bypassed decodeDomTapTarget entirely, so a covered/stale/off-viewport DOM target (the
//     safety hasStandingRows/decodeDomTapTarget already enforces on the legacy
//     selectCompletedTournament path) was never checked here -- restored below.
// (2) "Revalidation" copied title/startTime/organizer/location straight from selectedItem into
//     the comparison object, so on the fallback (no providerEventId) path,
//     assertSelectedEventIdentity was comparing selectedItem against an echo of itself: it could
//     never catch a wrong-page tap. Fixed: a fresh providerEventId read from the detail page's
//     OWN route is compared for real when the index side has one; when NEITHER side has an id,
//     the detail page's OWN rendered text (a fresh CDP read, not an echo) must independently
//     contain the selected title/startTime, or this fails closed.
export async function tapAndVerifyTournamentDetail(adb, port, options, selectedItem) {
  const validated = decodeDomTapTarget(JSON.stringify(selectedItem));
  const webViewBounds = findWebViewBounds(dumpUi(adb));
  tap(adb, mapDomPoint(validated.rect, validated.viewport, webViewBounds));
  await waitForTarget(port, TOURNAMENT_DETAIL_TARGET, options.homeTimeout * 1_000);

  const detailProviderEventId = await detailPageProviderEventId(port);
  const indexId = typeof selectedItem.providerEventId === "string" && selectedItem.providerEventId.length > 0
    ? selectedItem.providerEventId
    : null;
  const detailId = typeof detailProviderEventId === "string" && detailProviderEventId.length > 0
    ? detailProviderEventId
    : null;

  // F3 (fix round 2): the ONLY case that may skip the independent text check below is a genuine
  // TWO-SIDED id agreement -- both the index item and the detail page's own route carry a real
  // id, and they match. Every other combination (neither side has an id; only the index side
  // does; only the detail side does) previously either echoed selectedItem's own fields back at
  // itself or returned early on "nothing to disagree with" -- both were structurally incapable
  // of catching a wrong-page tap on those paths. A two-sided DISAGREEMENT is still an immediate,
  // unambiguous hard failure (two independent signals conflict; no text check could rescue that).
  if (indexId !== null && detailId !== null) {
    if (indexId !== detailId) {
      throw new Error(
        `event_identity_mismatch: detail page route id (${detailId}) does not match the selected event (${indexId})`,
      );
    }
    return;
  }

  const detailState = await readPageState(port, TOURNAMENT_DETAIL_TARGET);
  const detailLines = textLines(detailState.text);
  const requiredFields = [selectedItem.title, selectedItem.startTime].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (requiredFields.length === 0 || !requiredFields.every((value) => detailLines.includes(value))) {
    throw new Error(
      "event_identity_unverifiable: no two-sided provider id agreement is available and the "
        + "detail page's own text does not independently confirm the selected event's title/start time",
    );
  }
}

async function goBackToTournamentIndex(adb, port, options) {
  runAdb(adb, ["shell", "input", "keyevent", "KEYCODE_BACK"], "cannot navigate back");
  await waitForTarget(port, TOURNAMENT_INDEX_TARGET, options.homeTimeout * 1_000);
}

async function collectTournamentByKey(adb, homeXml, options, lease) {
  if (typeof options.eventKey !== "string" || options.eventKey.length === 0) {
    throw new Error("collect tournament requires --event-key KEY");
  }
  tap(adb, findUiTapPoint(homeXml, "赛事大厅"));
  await withTournamentIndexOpen(adb, options, async () => {
    const items = await enumerateVisibleTournamentIndexItems(options.devtoolsPort, options);
    const selected = selectTournamentByKey(items, options.eventKey);
    // Consistency extension of the batch-path viewport-reachability fix (fix round 2): the same
    // "selected but currently off-screen" risk applies here too, just without a preceding
    // back-navigation to trigger it.
    const reachable = await scrollSelectedItemIntoView(options.devtoolsPort, options, selected.selectionKey, selected);
    await tapAndVerifyTournamentDetail(adb, options.devtoolsPort, options, reachable);
    const identity = {
      title: reachable.title, startTime: reachable.startTime, status: reachable.status, game: TARGET_GAME,
    };
    const capture = await captureOpenTournamentDetail(adb, options.devtoolsPort, options, identity);
    printCaptureResult(buildCaptureEnvelope({
      surface: "tournament",
      sourceRef: { providerEventId: reachable.providerEventId, sanitizedRoute: "app:tournament-detail" },
      data: buildTypedTournamentEventData(capture),
      lifecycle: buildLifecycleMetadata(lease, { requested: options.cleanupStarted === true }),
    }));
  });
}

export async function collectTournamentBatch(adb, homeXml, options, lease) {
  if (typeof options.asOf !== "string" || options.asOf.length === 0) {
    throw new Error("collect tournament-batch requires --as-of DATE");
  }
  if (!Number.isInteger(options.windowDays) || options.windowDays <= 0) {
    throw new Error("collect tournament-batch requires --window-days DAYS");
  }
  tap(adb, findUiTapPoint(homeXml, "赛事大厅"));
  await withTournamentIndexOpen(adb, options, async () => {
    const initialItems = await enumerateVisibleTournamentIndexItems(options.devtoolsPort, options);
    const selected = filterTournamentsWithinWindow(initialItems, options.asOf, options.windowDays);
    if (selected.length === 0) {
      throw new Error(
        `no_events_in_window: no completed tournament falls within ${options.windowDays} day(s) of ${options.asOf}`,
      );
    }
    const selectedKeys = selected.map((item) => item.selectionKey);

    // F6 (fix round 1): the pre-fix loop tapped every selected item's rect/viewport from this
    // ONE initial enumeration, even after navigating back via KEYCODE_BACK -- but a back
    // navigation can re-render the index (lazy-loaded rows, scroll position reset, DOM node
    // identity churn), so a rect captured before any back-navigation may no longer correspond to
    // where that event is now rendered. Fixed: re-enumerate after every back-navigation and
    // resolve the NEXT item by its stable selectionKey against the FRESH read, never by trusting
    // a rect captured earlier in the loop; if the key is no longer visible, fail closed instead
    // of tapping a stale/guessed position.
    let currentItems = initialItems;
    const events = [];
    for (const [index, key] of selectedKeys.entries()) {
      const freshItem = currentItems.find((candidate) => candidate.selectionKey === key);
      if (!freshItem) {
        throw new Error(
          `event_key_not_found: selected event ${key} is no longer visible on the tournament index after navigating back`,
        );
      }
      // Viewport-reachability (fix round 2): KEYCODE_BACK resets scroll position, so a freshly
      // re-enumerated item can be present but still off-screen -- scroll it into view (bounded,
      // fail-closed) before ever attempting the tap.
      const reachableItem = await scrollSelectedItemIntoView(options.devtoolsPort, options, key, freshItem);
      await tapAndVerifyTournamentDetail(adb, options.devtoolsPort, options, reachableItem);
      const identity = {
        title: reachableItem.title, startTime: reachableItem.startTime, status: reachableItem.status, game: TARGET_GAME,
      };
      const capture = await captureOpenTournamentDetail(adb, options.devtoolsPort, options, identity);
      events.push({
        sourceRef: { providerEventId: reachableItem.providerEventId, sanitizedRoute: "app:tournament-detail" },
        data: buildTypedTournamentEventData(capture),
      });
      if (index < selectedKeys.length - 1) {
        await goBackToTournamentIndex(adb, options.devtoolsPort, options);
        currentItems = await enumerateVisibleTournamentIndexItems(options.devtoolsPort, options);
      }
    }
    // F8 (fix round 1, controller ruling -- done LAST, after confirming Task 7's concurrent
    // amendment landed: BATCH_DATA_FIELDS/assertRequestWindow now exist in
    // tools/jihuanshe_normalize.mjs). requestWindow carries exactly the two fields Task 7's
    // normalizer shape-validates: a local-date asOf and a positive integer windowDays -- the
    // SAME values already validated by filterTournamentsWithinWindow/parseArguments above.
    printCaptureResult(buildCaptureEnvelope({
      surface: "tournament-batch",
      sourceRef: { sanitizedRoute: "app:tournament-index" },
      data: { requestWindow: { asOf: options.asOf, windowDays: options.windowDays }, events },
      lifecycle: buildLifecycleMetadata(lease, { requested: options.cleanupStarted === true }),
    }));
  });
}

async function listTournaments(adb, homeXml, options) {
  tap(adb, findUiTapPoint(homeXml, "赛事大厅"));
  await withTournamentIndexOpen(adb, options, async () => {
    const items = await enumerateVisibleTournamentIndexItems(options.devtoolsPort, options);
    printStatus("ok", {
      items: items.map((item) => ({
        selectionKey: item.selectionKey,
        title: item.title,
        startTime: item.startTime,
        status: item.status,
      })),
    });
  });
}

export function parseArguments(argv) {
  const command = argv[0];
  let target;
  let index = 1;
  if (command === "collect" || command === "list") {
    target = argv[1];
    index = 2;
  }
  const options = {
    avd: OWNED_AVD,
    port: OWNED_PORT,
    devtoolsPort: 9222,
    bootTimeout: 180,
    homeTimeout: 45,
    itemCeiling: 500,
    maxScrolls: 40,
  };
  const names = new Map([
    ["--adb", "adb"],
    ["--emulator", "emulator"],
    ["--ps", "ps"],
    ["--avd", "avd"],
    ["--port", "port"],
    ["--devtools-port", "devtoolsPort"],
    ["--boot-timeout", "bootTimeout"],
    ["--home-timeout", "homeTimeout"],
    ["--event-key", "eventKey"],
    ["--as-of", "asOf"],
    ["--window-days", "windowDays"],
    ["--item-ceiling", "itemCeiling"],
    ["--max-scrolls", "maxScrolls"],
    ["--lock-path", "lockPath"],
  ]);
  const booleanNames = new Map([
    ["--cleanup-started", "cleanupStarted"],
  ]);
  for (; index < argv.length; index += 1) {
    const key = argv[index];
    if (booleanNames.has(key)) {
      options[booleanNames.get(key)] = true;
      continue;
    }
    const value = argv[index + 1];
    const name = names.get(key);
    if (!name || value === undefined) throw new Error(`invalid argument: ${key}`);
    options[name] = value;
    index += 1;
  }
  // F5 (fix round 1): maxScrolls now gates a hard failure (enumeration_did_not_stabilize) rather
  // than silently returning whatever the last round saw, so it needs to be an exposed, tunable
  // flag rather than a fixed internal constant.
  for (const name of ["port", "devtoolsPort", "bootTimeout", "homeTimeout", "itemCeiling", "maxScrolls"]) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (options.windowDays !== undefined) {
    options.windowDays = Number(options.windowDays);
    if (!Number.isInteger(options.windowDays) || options.windowDays <= 0) {
      throw new Error("windowDays must be a positive integer");
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

// F7 (fix round 1, controller ruling): every CLI failure -- reauth included -- now emits exactly
// ONE v2 CaptureResult-shaped envelope: { schemaVersion: 2, source, status: "error", stage, code,
// details, surface? }. Task 7 correctly refuses to normalize a status:"error" envelope (a failed
// capture is never normalized); Task 9 gates on exit code and status BEFORE ever normalizing.
// Success paths (status/start/stop's "ready"/"stopped"/etc.) are UNCHANGED -- only failures moved
// to this shape. `stage`/`surface` are tracked in this tiny module-level context, set as soon as
// the CLI knows which command (and, for collect/list, which target) it is running, so even a
// failure before any async work starts still reports a meaningful stage.
const failureContext = { stage: undefined, surface: undefined };

function printFailureEnvelope(code, details) {
  const envelope = {
    schemaVersion: 2,
    source: "JiHuanShe Android visible UI",
    status: "error",
    stage: failureContext.stage ?? "unknown",
    code,
    details,
  };
  if (failureContext.surface) envelope.surface = failureContext.surface;
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

async function start(options) {
  // Goes through withAvdDriveLock purely to serialize against a concurrent start/collect
  // invocation racing to spawn the same AVD; cleanupStartedOnFinish defaults to false, so the
  // AVD is left running for subsequent commands exactly as before -- only the coordination lock
  // itself is released once this returns.
  const lease = await withAvdDriveLock(buildLifecycleOptions(options), async (currentLease) => currentLease);
  printStatus("ready", {
    serial: OWNED_SERIAL,
    started: lease.startedByInvocation,
    launchMode: lease.launchMode,
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

// The CLI's `collect <target>` orchestration entry point, exported under the name the Task 8
// brief's interface list specifies. Threads the requested target (market | tournaments |
// tournament | tournament-batch) through withAvdDriveLock so exactly one AVD lock covers
// ensure-running, launchHome, the target-specific capture, and (if requested) invocation-owned
// cleanup.
export async function captureJiHuanShe(target, options) {
  await withAvdDriveLock(buildLifecycleOptions(options), async (lease) => {
    const adb = resolveAdb(options.adb);
    const homeXml = await launchHome(adb, options.homeTimeout * 1_000);
    if (target === "market") return collectMarket(adb, homeXml, options, lease);
    if (target === "tournaments") return collectTournaments(adb, homeXml, options, lease);
    if (target === "tournament") return collectTournamentByKey(adb, homeXml, options, lease);
    if (target === "tournament-batch") return collectTournamentBatch(adb, homeXml, options, lease);
    throw new Error("collect target must be market, tournaments, tournament, or tournament-batch");
  });
}

async function list(target, options) {
  if (target !== "tournaments") throw new Error("list target must be tournaments");
  await withAvdDriveLock(buildLifecycleOptions(options), async () => {
    const adb = resolveAdb(options.adb);
    const homeXml = await launchHome(adb, options.homeTimeout * 1_000);
    await listTournaments(adb, homeXml, options);
  });
}

function usage() {
  return `Usage:
  node tools/jihuanshe_capture.mjs collect market [options]
  node tools/jihuanshe_capture.mjs collect tournaments [options]
  node tools/jihuanshe_capture.mjs collect tournament --event-key KEY [options]
  node tools/jihuanshe_capture.mjs collect tournament-batch --as-of DATE --window-days DAYS [--cleanup-started] [options]
  node tools/jihuanshe_capture.mjs list tournaments [options]
  node tools/jihuanshe_capture.mjs start [options]
  node tools/jihuanshe_capture.mjs status [--adb PATH]
  node tools/jihuanshe_capture.mjs stop [--adb PATH]
`;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  failureContext.stage = rawArgs[0] ?? "unknown";
  const { command, target, options } = parseArguments(rawArgs);
  failureContext.stage = command;
  failureContext.surface = target;
  if (command === "status") {
    status(options);
    return;
  }
  if (command === "start") {
    await start(options);
    return;
  }
  if (command === "stop") {
    await stop(options);
    return;
  }
  if (command === "list") {
    await list(target, options);
    return;
  }
  if (command === "collect") {
    await captureJiHuanShe(target, options);
    return;
  }
  throw new Error(usage());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const uninstallTerminationHandlers = installTerminationHandlers(process, terminationCleanups);
  main().catch((error) => {
    // Exactly one v2 CaptureResult-shaped failure envelope on stdout for every failure --
    // reauth included, per the F7 controller ruling -- exit 2 only for reauth_required, exit 1
    // otherwise. The human-readable stderr line is diagnostic only and never feeds the
    // CaptureResult; a child process's OWN stderr never reaches it either.
    if (error instanceof ReauthRequiredError) {
      printFailureEnvelope("reauth_required", { message: error.message });
      process.exitCode = 2;
      return;
    }
    const code = error instanceof LifecycleError ? error.code : "error";
    const details = error instanceof LifecycleError && error.details && Object.keys(error.details).length > 0
      ? error.details
      : { message: error.message };
    printFailureEnvelope(code, details);
    process.stderr.write(`jihuanshe_capture: ${error.message}\n`);
    process.exitCode = 1;
  }).finally(uninstallTerminationHandlers);
}
