#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";

import {
  assertSelectedEventIdentity,
  buildCaptureEnvelope,
  collectTournamentBatch,
  collectTournaments,
  installLegacyEmitterForTest,
  buildEmulatorArgs,
  buildLifecycleMetadata,
  buildTypedMarketData,
  buildTypedMarketRows,
  buildTypedTournamentEventData,
  captureJiHuanShe,
  classifyHomeUi,
  decodeDomTapTarget,
  enumerateCompletedTournaments,
  enumerateVisibleTournamentIndexItems,
  filterTournamentsWithinWindow,
  findUiTapPoint,
  findWebViewBounds,
  installCdpDriverForTest,
  installResultEmitterForTest,
  isTargetMarketUi,
  looksLikeMarketCardLabel,
  mapDomPoint,
  parseArguments,
  parseEmulatorAvdName,
  parseReadyDevices,
  parseUiHierarchy,
  selectLatestCompletedTournament,
  selectTournamentByKey,
  selectionKeyForTournament,
  stopEmulatorArgs,
  tapAndVerifyTournamentDetail,
  TOURNAMENT_ITEMS_EXPRESSION,
  validateTournamentCapture,
} from "./jihuanshe_capture.mjs";
import { normalizeJiHuanSheCapture } from "./jihuanshe_normalize.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------------------
// Fake-DOM harness (F2): actually EXECUTES a DOM-extraction expression string against a
// controlled fake document/window via node:vm, rather than only reading the source. This is the
// only way to catch a bug that lives in the JS-string logic itself (an operator-precedence
// mistake reads fine on inspection but produces the wrong value when run).
// ---------------------------------------------------------------------------------------

function makeFakeElement({
  text = "", attributes = {}, dataset = {}, rect = { left: 0, top: 0, width: 100, height: 40 },
} = {}) {
  const element = {
    innerText: text,
    textContent: text,
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null),
    dataset,
    getBoundingClientRect: () => rect,
    contains: (other) => other === element,
  };
  return element;
}

function runDomExpression(expression, elements, { viewport = { width: 1080, height: 2400 }, elementFromPoint } = {}) {
  const context = vm.createContext({
    document: {
      querySelectorAll: () => elements,
      elementFromPoint: (x, y) => (elementFromPoint ? elementFromPoint(x, y, elements) : elements[0] ?? null),
    },
    window: { innerWidth: viewport.width, innerHeight: viewport.height },
  });
  return vm.runInContext(expression, context);
}

// ---------------------------------------------------------------------------------------
// Fake-CDP harness (S3/S4/S5, reviewer-recommended seam): drives the real enumeration,
// tap-and-verify, and batch orchestration functions against SCRIPTED evaluate() responses,
// installed via installCdpDriverForTest. No real fetch/WebSocket is ever touched.
// ---------------------------------------------------------------------------------------

// `evaluateImpl(expression, callIndex, target, port)` gets full control per call -- tests branch
// on `expression` themselves (e.g. `expression.includes("scrollBy")` for the scroll trigger vs.
// the tournament-items read) rather than this harness guessing which "slot" a call belongs to.
// `targets` may be a static array OR a function re-evaluated on every fetchTargets() call --
// the latter lets a test's detail-target URL (e.g. its id-shaped query param) track which event
// is currently open, matching what a real detail-page navigation would report.
function installScriptedCdpDriver({
  targets = [{ title: "pages/tournaments/index", url: "app://index" }], evaluate: evaluateImpl,
} = {}) {
  const calls = [];
  const uninstall = installCdpDriverForTest({
    fetchTargets: async () => (typeof targets === "function" ? targets() : targets),
    evaluate: async (target, expression, port) => {
      calls.push({ target: target?.title, expression });
      return evaluateImpl(expression, calls.length - 1, target, port);
    },
  });
  return { uninstall, calls };
}

function rawIndexItem({
  providerEventId, title, startTime, status = "已结束", organizer, location, hit = true,
  rect = { left: 0, top: 0, width: 200, height: 60 }, viewport = { width: 1080, height: 2400 },
} = {}) {
  return {
    providerEventId, title, startTime, status, organizer, location, rect, viewport, hit,
  };
}

function fakeAdbScript(directory) {
  const path = join(directory, "adb");
  // exec-out cat always answers with a visible WebView bounds dump: in every test that uses
  // this fake, dumpUi() is only ever consulted via findWebViewBounds(dumpUi(adb)) inside
  // tapAndVerifyTournamentDetail, never a home-screen classification read.
  writeFileSync(path, `#!/bin/sh
printf '%s\\n' "$*" >> "${join(directory, "adb.log")}"
case "$*" in
  "devices") printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"getprop sys.boot_completed"*) printf '1\\n' ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *"shell pidof com.jihuanshe"*) printf '12345\\n' ;;
  *"cat /proc/net/unix"*) printf '0000000000000000: 00000002 00000000 00000000 0001 03 12345 @webview_devtools_remote_12345\\n' ;;
  *"forward"*) exit 0 ;;
  *"uiautomator dump"*) exit 0 ;;
  *"exec-out cat /sdcard/jihuanshe-capture-"*)
    printf '%s' '<hierarchy><node class="android.webkit.WebView" bounds="[0,0][1080,2400]"/></hierarchy>' ;;
  *"input tap"*) printf '%s\\n' "$*" >> "${join(directory, "taps.log")}" ;;
  *"input keyevent KEYCODE_BACK"*) exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function fakePsScript(directory) {
  const path = join(directory, "ps");
  writeFileSync(path, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*) printf '888888 /fake/existing-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

test("buildEmulatorArgs enables headless persistent-data-safe flags", () => {
  const args = buildEmulatorArgs({ avd: "JiHuanShe_SC", port: 5554 });

  assert.ok(Array.isArray(args));
  assert.deepEqual(args.slice(0, 2), ["-avd", "JiHuanShe_SC"]);
  assert.equal(args[args.indexOf("-port") + 1], "5554");
  for (const required of [
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-no-metrics",
    "-no-snapshot",
  ]) {
    assert.ok(args.includes(required), `missing ${required}`);
  }
  for (const forbidden of ["-wipe-data", "-read-only", "-no-snapshot-save"]) {
    assert.equal(args.includes(forbidden), false, `unsafe flag ${forbidden}`);
  }
  assert.throws(
    () => buildEmulatorArgs({ avd: "JiHuanShe_SC", port: 5556 }),
    /5554|owned|port/i,
  );
  assert.throws(
    () => buildEmulatorArgs({ avd: "Another_AVD", port: 5554 }),
    /JiHuanShe_SC|AVD|owned/i,
  );
});

test("parseUiHierarchy builds a nested tree and decodes XML attributes", () => {
  const parsed = parseUiHierarchy(`<?xml version="1.0" encoding="UTF-8"?>
    <hierarchy rotation="0">
      <node text="航海王&amp;简中" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
        <node text="行情" content-desc="市场&#10;行情" clickable="true" bounds="[100,200][300,400]" />
      </node>
    </hierarchy>`);

  assert.equal(parsed.tag, "hierarchy");
  assert.equal(parsed.attributes.rotation, "0");
  assert.equal(parsed.children.length, 1);
  assert.equal(parsed.children[0].attributes.text, "航海王&简中");
  assert.equal(parsed.children[0].children[0].attributes["content-desc"], "市场\n行情");
  assert.equal(parsed.children[0].children[0].attributes.clickable, "true");
});

test("parseUiHierarchy rejects malformed or non-hierarchy XML", () => {
  assert.throws(() => parseUiHierarchy("permission denied"), /hierarchy/i);
  assert.throws(
    () => parseUiHierarchy("<hierarchy><node></hierarchy>"),
    /XML|hierarchy|malformed/i,
  );
});

test("findUiTapPoint matches an exact text/content-desc line and nearest clickable ancestor", () => {
  const xml = `<hierarchy>
    <node text="" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
      <node text="实时行情" content-desc="" clickable="true" bounds="[10,20][110,120]" />
      <node text="" content-desc="菜单&#10;行情&#10;更多" clickable="true" bounds="[100,200][300,400]">
        <node text="" content-desc="行情" clickable="false" bounds="[120,220][280,380]" />
      </node>
      <node text="市场行情" content-desc="" clickable="true" bounds="[400,200][600,400]" />
    </node>
  </hierarchy>`;

  assert.deepEqual(findUiTapPoint(xml, "行情"), { x: 200, y: 300 });
  assert.deepEqual(findUiTapPoint(xml, "实时行情"), { x: 60, y: 70 });
  assert.throws(() => findUiTapPoint(xml, "行"), /not found|exact/i);
});

test("findUiTapPoint fails closed when the matching node has no clickable ancestor", () => {
  const xml = `<hierarchy>
    <node text="" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
      <node text="行情" content-desc="" clickable="false" bounds="[100,200][300,400]" />
    </node>
  </hierarchy>`;

  assert.throws(() => findUiTapPoint(xml, "行情"), /clickable|tap/i);
});

test("findUiTapPoint can require an exact attribute value to disambiguate selectors", () => {
  const xml = `<hierarchy>
    <node text="" content-desc="宝可梦&#10;简中" clickable="true" bounds="[0,0][200,100]" />
    <node text="" content-desc="简中" clickable="true" bounds="[200,0][400,100]" />
  </hierarchy>`;

  assert.deepEqual(
    findUiTapPoint(xml, "简中", { attribute: "content-desc", exactValue: true }),
    { x: 300, y: 50 },
  );
});

test("classifyHomeUi distinguishes ready, reauthentication, and unknown screens", () => {
  const ready = `<hierarchy>
    <node text="赛事大厅" content-desc="" />
    <node text="集换行情" content-desc="" />
  </hierarchy>`;
  const reauth = `<hierarchy>
    <node text="手机号登录" content-desc="" />
    <node text="获取验证码" content-desc="" />
  </hierarchy>`;
  const loading = `<hierarchy><node text="加载中…" content-desc="" /></hierarchy>`;

  assert.equal(classifyHomeUi(ready), "ready");
  assert.equal(classifyHomeUi(reauth), "reauth_required");
  assert.equal(classifyHomeUi(loading), "unknown");
});

test("isTargetMarketUi requires both 航海王 and 简中 on the selected market", () => {
  const fixture = (selection) => `<hierarchy>
    <node text="" content-desc="${selection}" clickable="true" bounds="[0,0][100,100]" />
    <node text="" content-desc="航海王总行情" clickable="false" bounds="[0,100][100,200]" />
  </hierarchy>`;

  assert.equal(isTargetMarketUi(fixture("航海王&#10;简中")), true);
  assert.equal(isTargetMarketUi(fixture("航海王&#10;日文")), false);
  assert.equal(isTargetMarketUi(fixture("宝可梦&#10;简中")), false);
  assert.equal(isTargetMarketUi(`<hierarchy>
    <node text="" content-desc="航海王&#10;日文" visible-to-user="true" />
    <node text="" content-desc="航海王&#10;简中" visible-to-user="false" />
    <node text="" content-desc="航海王总行情" visible-to-user="true" />
  </hierarchy>`), false);
});

test("mapDomPoint maps a DOM rectangle center into WebView screen coordinates", () => {
  assert.deepEqual(
    mapDomPoint(
      { left: 100, top: 50, width: 200, height: 100 },
      { width: 400, height: 200 },
      { left: 10, top: 20, width: 800, height: 400 },
    ),
    { x: 410, y: 220 },
  );
});

test("findWebViewBounds chooses the visible largest WebView", () => {
  const xml = `<hierarchy>
    <node class="android.webkit.WebView" bounds="[10,20][210,220]" />
    <node class="android.webkit.WebView" bounds="[0,100][1080,2300]" />
  </hierarchy>`;

  assert.deepEqual(findWebViewBounds(xml), {
    left: 0,
    top: 100,
    width: 1080,
    height: 2200,
  });
  assert.throws(
    () => findWebViewBounds("<hierarchy><node class=\"android.view.View\" /></hierarchy>"),
    /WebView/i,
  );
});

test("decodeDomTapTarget rejects hidden, stale, or off-viewport targets", () => {
  const valid = JSON.stringify({
    rect: { left: 100, top: 50, width: 200, height: 100 },
    viewport: { width: 400, height: 200 },
    hit: true,
    identity: { title: "赛事 A", startTime: "2026-08-18", status: "已结束" },
  });
  assert.deepEqual(decodeDomTapTarget(valid).identity, {
    title: "赛事 A",
    startTime: "2026-08-18",
    status: "已结束",
  });
  assert.throws(() => decodeDomTapTarget(JSON.stringify({
    rect: { left: 500, top: 50, width: 20, height: 20 },
    viewport: { width: 400, height: 200 },
    hit: true,
  })), /viewport|bounds/i);
  assert.throws(() => decodeDomTapTarget(JSON.stringify({
    rect: { left: 10, top: 10, width: 20, height: 20 },
    viewport: { width: 400, height: 200 },
    hit: false,
  })), /covered|stale|target/i);
});

test("validateTournamentCapture binds game, event identity, active tabs, and non-empty data", () => {
  const capture = {
    identity: { title: "赛事 A", startTime: "2026-08-18", game: "航海王简中" },
    detailText: "详情\n卡组\n赛果\n赛事 A\n航海王简中\n2026-08-18\n已结束",
    results: {
      activeTab: "赛果",
      text: "赛事 A\n航海王简中\n2026-08-18\n瑞士轮\n选手\n胜平负\n分数\n1st\n甲\n3-0-0\n9",
    },
    decks: {
      activeTab: "卡组",
      text: "赛事 A\n航海王简中\n2026-08-18\n卡组分布\n卡组\n数量\n占比\n红紫\n1\n100%\n卡组列表\n名次\n选手\n1st\n甲\n红紫",
    },
  };

  assert.doesNotThrow(() => validateTournamentCapture(capture));
  assert.throws(
    () => validateTournamentCapture({ ...capture, detailText: capture.detailText.replace("航海王简中", "宝可梦简中") }),
    /game|航海王简中/i,
  );
  assert.throws(
    () => validateTournamentCapture({ ...capture, results: { ...capture.results, activeTab: "详情" } }),
    /active|赛果/i,
  );
  assert.throws(
    () => validateTournamentCapture({
      ...capture,
      results: {
        activeTab: "赛果",
        text: "赛事 A\n航海王简中\n2026-08-18\n瑞士轮\n选手\n胜平负\n分数\n- END -",
      },
    }),
    /standing|record|赛果|data/i,
  );
  assert.throws(
    () => validateTournamentCapture({ ...capture, decks: { activeTab: "卡组", text: "暂无数据" } }),
    /deck|卡组|empty|data/i,
  );
  assert.throws(
    () => validateTournamentCapture({
      ...capture,
      decks: {
        activeTab: "卡组",
        text: "赛事 A\n航海王简中\n2026-08-18\n卡组分布\n卡组\n数量\n占比\n卡组列表\n名次\n选手\n- END -",
      },
    }),
    /deck|卡组|row|data/i,
  );
});

test("selectLatestCompletedTournament returns the newest completed item by start time", () => {
  const items = [
    { id: "running", status: "进行中", startTime: "2026-08-20" },
    { id: "completed-a", status: "已结束", startTime: "2026-08-18" },
    { id: "completed-b", status: "已结束", startTime: "2026-08-19" },
  ];

  assert.deepEqual(selectLatestCompletedTournament(items), items[2]);
  assert.equal(selectLatestCompletedTournament([{ id: "live", status: "进行中" }]), undefined);
  assert.equal(selectLatestCompletedTournament([]), undefined);
});

test("parseReadyDevices keeps only devices in the ready state", () => {
  const output = `List of devices attached\n
    emulator-5554\tdevice product:sdk_gphone_arm64 transport_id:1\n
    emulator-5556\toffline\n
    physical-1\tunauthorized\n`;

  assert.deepEqual(parseReadyDevices(output), ["emulator-5554"]);
  assert.deepEqual(parseReadyDevices("List of devices attached\n"), []);
});

test("parseEmulatorAvdName accepts one console name and rejects ambiguous output", () => {
  assert.equal(parseEmulatorAvdName("JiHuanShe_SC\r\nOK\r\n"), "JiHuanShe_SC");
  assert.throws(() => parseEmulatorAvdName("OK\n"), /AVD name/i);
  assert.throws(() => parseEmulatorAvdName("one\ntwo\nOK\n"), /AVD name/i);
});

test("stopEmulatorArgs is restricted to the owned emulator serial", () => {
  assert.deepEqual(stopEmulatorArgs("emulator-5554"), ["-s", "emulator-5554", "emu", "kill"]);
  for (const serial of ["emulator-5556", "physical-1", "", "emulator-5554;rm -rf /"]) {
    assert.throws(() => stopEmulatorArgs(serial), /emulator-5554|serial|refus/i);
  }
});

test("stop refuses emulator-5554 when it is not the owned AVD", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-foreign-avd-test-"));
  const fakeAdb = join(directory, "adb");
  const adbLog = join(directory, "adb.log");

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"emu avd name"*) printf 'Another_AVD\\nOK\\n' ;;
  *"emu kill"*) exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      ["tools/jihuanshe_capture.mjs", "stop", "--adb", fakeAdb],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, JHS_FAKE_ADB_LOG: adbLog },
      },
    );

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Another_AVD|JiHuanShe_SC|owned AVD/i);
    const log = readFileSync(adbLog, "utf8");
    assert.match(log, /emu avd name/);
    assert.doesNotMatch(log, /emu kill/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI does not invoke the emulator executable when adb and ps both already confirm the owned AVD online", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-capture-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const fakePs = join(directory, "ps");
  const adbLog = join(directory, "adb.log");
  const emulatorCalled = join(directory, "emulator-called");
  const lockPath = join(directory, "avd-drive.lock");

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  // A fixed, synthetic PID stands in for an already-running owned emulator; jihuanshe_lifecycle.mjs
  // never checks whether this PID is REALLY alive on the host, only what this fake reports for it.
  writeFileSync(fakePs, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*) printf '999999 /fake/existing-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf 'called\\n' > "$JHS_FAKE_EMULATOR_CALLED"
exit 91
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--ps", fakePs,
        "--lock-path", lockPath,
        "--avd", "JiHuanShe_SC",
        "--port", "5554",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          JHS_FAKE_ADB_LOG: adbLog,
          JHS_FAKE_EMULATOR_CALLED: emulatorCalled,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).started, false);
    assert.equal(requireExists(emulatorCalled), false);
    assert.equal(requireExists(lockPath), false, "the coordination lock must be released after start returns");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start waits for a newly spawned headless emulator to become boot-complete", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-start-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const fakePs = join(directory, "ps");
  const emulatorArgs = join(directory, "emulator-args");
  const emulatorPid = join(directory, "emulator-pid");
  const bootCounter = join(directory, "boot-counter");
  const lockPath = join(directory, "avd-drive.lock");

  // A fixed, fake "lstart" is fine here: this fake never needs to detect PID reuse, only to
  // answer with SOME non-empty exact-start-time string for whatever pid the emulator reports.
  writeFileSync(fakePs, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*)
    if [ -f "$JHS_FAKE_EMULATOR_PID" ]; then
      printf '%s /fake/spawned-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' "$(cat "$JHS_FAKE_EMULATOR_PID")"
    fi ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeAdb, `#!/bin/sh
case "$*" in
  *"getprop sys.boot_completed"*)
    count=0
    [ -f "$JHS_FAKE_BOOT_COUNTER" ] && count=$(cat "$JHS_FAKE_BOOT_COUNTER")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$JHS_FAKE_BOOT_COUNTER"
    if [ "$count" -ge 3 ]; then printf '1\\n'; else printf '0\\n'; fi ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$*" > "$JHS_FAKE_EMULATOR_ARGS"
printf '%s\\n' "$$" > "$JHS_FAKE_EMULATOR_PID"
trap 'exit 0' TERM INT
while :; do /bin/sleep 1; done
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--ps", fakePs,
        "--lock-path", lockPath,
        "--avd", "JiHuanShe_SC",
        "--port", "5554",
        "--boot-timeout", "5",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          JHS_FAKE_EMULATOR_ARGS: emulatorArgs,
          JHS_FAKE_EMULATOR_PID: emulatorPid,
          JHS_FAKE_BOOT_COUNTER: bootCounter,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, "ready");
    assert.equal(JSON.parse(result.stdout).started, true);
    const args = readFileSync(emulatorArgs, "utf8");
    assert.match(args, /-no-window/);
    assert.doesNotMatch(args, /-wipe-data|-read-only|-no-snapshot-save/);
    // This CLI process left the spawned (now booted) AVD running for later commands; clean it
    // up ourselves so the test does not leak a process.
    const pid = Number(readFileSync(emulatorPid, "utf8").trim());
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start terminates only the newly spawned emulator process when boot times out", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-boot-timeout-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const fakePs = join(directory, "ps");
  const adbLog = join(directory, "adb.log");
  const emulatorPid = join(directory, "emulator.pid");
  const terminated = join(directory, "terminated");
  const lockPath = join(directory, "avd-drive.lock");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\n' ;;
  *"getprop sys.boot_completed"*) printf '0\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  // Reflects the fake emulator's ACTUAL liveness via kill -0 on its own recorded pid -- this is
  // a test-fixture check on a process this test itself spawned, not a live Android/adb/emulator
  // operation, and it is what lets terminateJustSpawnedProcess observe the SIGTERM taking effect
  // instead of always falling through to its slower SIGKILL escalation path.
  writeFileSync(fakePs, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*)
    if [ -f "$JHS_FAKE_EMULATOR_PID" ]; then
      pid=$(cat "$JHS_FAKE_EMULATOR_PID")
      if kill -0 "$pid" 2>/dev/null; then
        printf '%s /fake/spawned-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' "$pid"
      fi
    fi ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$$" > "$JHS_FAKE_EMULATOR_PID"
trap 'printf terminated > "$JHS_FAKE_TERMINATED"; exit 0' TERM INT
while :; do /bin/sleep 1; done
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--ps", fakePs,
        "--lock-path", lockPath,
        "--boot-timeout", "1",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          JHS_FAKE_ADB_LOG: adbLog,
          JHS_FAKE_EMULATOR_PID: emulatorPid,
          JHS_FAKE_TERMINATED: terminated,
        },
      },
    );

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /boot.*timed out/i);
    assert.equal(readFileSync(terminated, "utf8"), "terminated");
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
    assert.doesNotMatch(readFileSync(adbLog, "utf8"), /emu kill/);
    assert.equal(requireExists(lockPath), false, "a failed start must still release the coordination lock");
    // S2 (fix round 1): a non-reauth CLI failure is exactly one parsed v2 CaptureResult-shaped
    // JSON object on stdout (JSON.parse over the ENTIRE stdout content fails if anything besides
    // one JSON value is present), exit 1, with this process's own stderr text never leaking in.
    assert.doesNotThrow(() => JSON.parse(result.stdout), "stdout must be exactly one JSON object");
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.schemaVersion, 2);
    assert.equal(failure.status, "error");
    assert.equal(failure.code, "lifecycle_timeout");
    assert.equal(failure.stage, "start");
    assert.equal(JSON.stringify(failure).includes("jihuanshe_capture:"), false);
  } finally {
    if (requireExists(emulatorPid)) {
      const pid = Number(readFileSync(emulatorPid, "utf8").trim());
      if (Number.isInteger(pid) && pid > 1) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    sentinel.kill("SIGTERM");
    rmSync(directory, { recursive: true, force: true });
  }
});

// Vacuous-test repair (fix round 1): the previous version of this test used `start`, whose
// window between "lock created" and "callback returns, lock released normally" is essentially
// zero (start's callback is a trivial synchronous-ish return), and it sent SIGTERM the instant
// the fake emulator's pid file appeared -- which happens WHILE startOwnedAvd is still polling
// for a boot_completed the fake adb never reports, i.e. strictly BEFORE withAvdDriveLock ever
// writes the lock file. So `assert.equal(requireExists(lockPath), false)` passed for the wrong
// reason (the lock never existed at all, not because a signal released it) and stayed green even
// with releaseLockIfOwned turned into a no-op. Fixed by using `collect market` instead (a real,
// long-running callback via launchHome's home-screen poll) and waiting for the LOCK FILE itself
// to exist before signaling, so the assertions can only pass if the signal path genuinely ran.
test("SIGTERM on a held lock (mid-capture) releases it without stopping the AVD, and the CLI exits by signal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-signal-cleanup-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const fakePs = join(directory, "ps");
  const emulatorPid = join(directory, "emulator.pid");
  const lockPath = join(directory, "avd-drive.lock");
  let cli;

  writeFileSync(fakeAdb, `#!/bin/sh
case "$*" in
  "devices") printf 'List of devices attached\\n' ;;
  *"getprop sys.boot_completed"*) printf '1\\n' ;;
  *"exec-out cat /sdcard/jihuanshe-capture-"*)
    printf '%s' '<hierarchy><node text="加载中" content-desc=""/></hierarchy>' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakePs, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*)
    if [ -f "$JHS_FAKE_EMULATOR_PID" ]; then
      pid=$(cat "$JHS_FAKE_EMULATOR_PID")
      if kill -0 "$pid" 2>/dev/null; then
        printf '%s /fake/spawned-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' "$pid"
      fi
    fi ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$$" > "$JHS_FAKE_EMULATOR_PID"
trap 'exit 0' TERM INT
while :; do /bin/sleep 1; done
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    cli = spawn(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "collect", "market",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--ps", fakePs,
        "--lock-path", lockPath,
        "--boot-timeout", "60",
        "--home-timeout", "60",
      ],
      {
        cwd: REPO_ROOT,
        stdio: "ignore",
        env: {
          ...process.env,
          JHS_FAKE_EMULATOR_PID: emulatorPid,
        },
      },
    );
    // Wait for the LOCK FILE itself, not just the emulator pid -- this is the fix. Boot
    // completes ("1") quickly, so withAvdDriveLock writes the lock and the (never-resolving)
    // launchHome poll keeps the callback genuinely in flight when the signal arrives.
    await waitFor(() => requireExists(lockPath), 5_000);
    assert.equal(cli.kill("SIGTERM"), true);
    const result = await new Promise((resolve) => {
      cli.once("exit", (code, signal) => resolve({ code, signal }));
    });

    assert.deepEqual(result, { code: null, signal: "SIGTERM" });
    assert.equal(requireExists(lockPath), false, "the signal path must release the lock that genuinely existed");
    // Default (no --cleanup-started): the AVD survives its own invocation, even on a signal.
    const pid = Number(readFileSync(emulatorPid, "utf8").trim());
    assert.doesNotThrow(() => process.kill(pid, 0), "the AVD must NOT be stopped without --cleanup-started");
  } finally {
    if (cli?.exitCode === null && cli?.signalCode === null) cli.kill("SIGKILL");
    if (requireExists(emulatorPid)) {
      const pid = Number(readFileSync(emulatorPid, "utf8").trim());
      if (Number.isInteger(pid) && pid > 1) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("collect market reports reauth_required without exposing or clearing credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-reauth-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const fakePs = join(directory, "ps");
  const adbLog = join(directory, "adb.log");
  const emulatorCalled = join(directory, "emulator-called");
  const lockPath = join(directory, "avd-drive.lock");

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"getprop sys.boot_completed"*) printf '1\\n' ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *"exec-out cat /sdcard/jihuanshe-capture-"*)
    printf '%s' '<hierarchy><node text="手机号登录" content-desc=""/><node text="获取验证码" content-desc=""/></hierarchy>' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  // A fixed synthetic "already running" process, entirely independent of anything really
  // running on the host -- this is exactly the injected-runner isolation the safety rules
  // require: without this fake, jihuanshe_lifecycle.mjs falls back to the REAL /bin/ps, which
  // would read whatever real host state happens to exist.
  writeFileSync(fakePs, `#!/bin/sh
case "$*" in
  *"-axwwo pid=,command="*) printf '888888 /fake/existing-emulator -avd JiHuanShe_SC -port 5554 -no-window\\n' ;;
  *"-o lstart="*) printf 'Wed Aug 20 12:00:00 2026\\n' ;;
  *) printf '' ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf 'called\\n' > "$JHS_FAKE_EMULATOR_CALLED"
exit 91
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "collect", "market",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--ps", fakePs,
        "--lock-path", lockPath,
        "--home-timeout", "2",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          JHS_FAKE_ADB_LOG: adbLog,
          JHS_FAKE_EMULATOR_CALLED: emulatorCalled,
        },
      },
    );

    // F7 (fix round 1, controller ruling): every failure -- reauth included -- is now a v2
    // CaptureResult-shaped envelope with status ALWAYS "error"; the specific reason lives in
    // `code`, not `status`.
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.schemaVersion, 2);
    assert.equal(failure.status, "error");
    assert.equal(failure.code, "reauth_required");
    assert.equal(typeof failure.stage, "string");
    assert.ok(failure.stage.length > 0);
    assert.equal(requireExists(emulatorCalled), false);
    const log = readFileSync(adbLog, "utf8");
    assert.doesNotMatch(log, /pm clear|wipe-data/);
    assert.equal(requireExists(lockPath), false, "a reauth failure must still release the coordination lock");
    // Zero stderr leakage into the CaptureResult: the failure object never carries this
    // process's own stderr text.
    assert.equal(JSON.stringify(failure).includes("jihuanshe_capture:"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function requireExists(path) {
  try {
    readFileSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

// =========================================================================================
// Task 8: stable tournament selection, CaptureResult v2 assembly, and CLI argument parsing.
// All pure functions below -- no ADB/CDP, no process/lock lifecycle (that is
// tools/jihuanshe_lifecycle.test.mjs's job).
// =========================================================================================

// F2 (fix round 1, CRITICAL-adjacent regression): `getAttribute("url") || getAttribute("href")
// || dataset ? dataset.url : undefined` parses as `(a || b || dataset) ? dataset.url :
// undefined` -- since `element.dataset` is always a truthy object, this ALWAYS evaluated to
// `dataset.url`, so the url/href attribute was completely unreachable no matter what it
// contained. This can only be caught by actually EXECUTING the expression string (a static read
// looks plausible), so this test runs the real, unmodified TOURNAMENT_ITEMS_EXPRESSION against a
// fake DOM via node:vm.
test("F2: TOURNAMENT_ITEMS_EXPRESSION reads providerEventId from the element's url attribute", () => {
  const element = makeFakeElement({
    text: "赛事甲\n2026-08-18\n已结束",
    attributes: { url: "/tournamentPack/pages/detail/detail?id=42&ref=xyz" },
    rect: { left: 0, top: 0, width: 200, height: 60 },
  });
  const json = runDomExpression(TOURNAMENT_ITEMS_EXPRESSION, [element]);
  const [item] = JSON.parse(json);
  assert.equal(item.providerEventId, "42", "the id-shaped query parameter must be read, nothing else of the URL");
  assert.equal(item.title, "赛事甲");
});

test("F2: falls back to the href attribute, then to dataset.url, in that order", () => {
  const hrefOnly = makeFakeElement({
    text: "赛事乙\n2026-08-19\n已结束",
    attributes: { href: "/detail?eventId=7" },
  });
  const [hrefItem] = JSON.parse(runDomExpression(TOURNAMENT_ITEMS_EXPRESSION, [hrefOnly]));
  assert.equal(hrefItem.providerEventId, "7");

  const datasetOnly = makeFakeElement({
    text: "赛事丙\n2026-08-20\n已结束",
    dataset: { url: "/detail?tid=9" },
  });
  const [datasetItem] = JSON.parse(runDomExpression(TOURNAMENT_ITEMS_EXPRESSION, [datasetOnly]));
  assert.equal(datasetItem.providerEventId, "9");

  const noRoute = makeFakeElement({ text: "赛事丁\n2026-08-21\n已结束" });
  const [noRouteItem] = JSON.parse(runDomExpression(TOURNAMENT_ITEMS_EXPRESSION, [noRoute]));
  assert.equal(noRouteItem.providerEventId, undefined);
});

test("selectionKeyForTournament prefers providerEventId over any fallback fields", () => {
  const withId = selectionKeyForTournament({ providerEventId: "42", title: "赛事 A", startTime: "2026-08-18" });
  assert.equal(withId, "jihuanshe:tournament:42");

  const withoutId = selectionKeyForTournament({ title: "赛事 A", startTime: "2026-08-18" });
  assert.ok(withoutId.startsWith("jihuanshe:tournament:fallback:"));
  assert.notEqual(withoutId, withId);
});

test("selectionKeyForTournament's fallback key uses only the fields actually present, and is deterministic", () => {
  const a = selectionKeyForTournament({ title: "赛事 A", startTime: "2026-08-18" });
  const b = selectionKeyForTournament({ title: "赛事 A", startTime: "2026-08-18" });
  const withOrganizer = selectionKeyForTournament({ title: "赛事 A", startTime: "2026-08-18", organizer: "官方" });
  const differentTitle = selectionKeyForTournament({ title: "赛事 B", startTime: "2026-08-18" });

  assert.equal(a, b);
  assert.notEqual(a, withOrganizer, "a present optional field must change the fallback key");
  assert.notEqual(a, differentTitle);
  assert.throws(() => selectionKeyForTournament(null), /tournament item object/);
});

test("enumerateCompletedTournaments enumerates every completed event, not just the newest", () => {
  const items = [
    { title: "赛事 A", startTime: "2026-08-18", status: "已结束" },
    { title: "赛事 B", startTime: "2026-08-19", status: "已结束" },
    { title: "赛事 C", startTime: "2026-08-20", status: "进行中" },
  ];
  const completed = enumerateCompletedTournaments(items);
  assert.equal(completed.length, 2);
  assert.deepEqual(completed.map((item) => item.title), ["赛事 B", "赛事 A"]);
  for (const item of completed) assert.equal(typeof item.selectionKey, "string");
});

test("enumerateCompletedTournaments fails closed (event_identity_ambiguous) rather than guessing between two colliding keys", () => {
  const items = [
    { title: "赛事 A", startTime: "2026-08-18", status: "已结束" },
    { title: "赛事 A", startTime: "2026-08-18", status: "已结束" },
  ];
  assert.throws(
    () => enumerateCompletedTournaments(items),
    /event_identity_ambiguous/,
  );
});

test("enumerateCompletedTournaments enforces a configurable hard item ceiling as a failure, not a partial result", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({
    title: `赛事 ${index}`,
    startTime: `2026-08-${String(10 + index).padStart(2, "0")}`,
    status: "已结束",
  }));
  assert.throws(
    () => enumerateCompletedTournaments(items, { itemCeiling: 4 }),
    /item_ceiling_exceeded/,
  );
  assert.equal(enumerateCompletedTournaments(items, { itemCeiling: 5 }).length, 5);
});

// F5/S4 (fix round 1): enumerateVisibleTournamentIndexItems, driven via the injectable fake-CDP
// seam. S4: the pre-fix suite had zero coverage of the SCROLL LOOP itself -- a mutant that made
// it stop after one read went undetected. F5: cap exhaustion without ever seeing two identical
// reads used to return a silent partial (whatever the last round saw) instead of failing; and
// the stability signature was computed over completed items only, so a still-loading
// non-completed row underneath an already-stable completed subset could not be seen.

function isScrollExpression(expression) {
  return expression.includes("scrollBy");
}

test("S4: enumerateVisibleTournamentIndexItems scrolls and re-reads until two consecutive reads match (the loop is genuinely driven, not a single read)", async () => {
  const reads = [
    [rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18" })],
    [
      rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18" }),
      rawIndexItem({ providerEventId: "e2", title: "赛事二", startTime: "2026-08-19" }),
    ],
    // Third read identical to the second -- this is what must trigger the stop.
    [
      rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18" }),
      rawIndexItem({ providerEventId: "e2", title: "赛事二", startTime: "2026-08-19" }),
    ],
  ];
  let itemsCallCount = 0;
  const { uninstall, calls } = installScriptedCdpDriver({
    evaluate: (expression) => {
      if (isScrollExpression(expression)) return "true";
      const response = JSON.stringify(reads[Math.min(itemsCallCount, reads.length - 1)]);
      itemsCallCount += 1;
      return response;
    },
  });
  try {
    const items = await enumerateVisibleTournamentIndexItems(9222, { maxScrolls: 10, itemCeiling: 100 });
    assert.equal(itemsCallCount, 3, "must keep reading until two CONSECUTIVE reads agree, not stop after one");
    assert.deepEqual(items.map((item) => item.title).toSorted(), ["赛事一", "赛事二"]);
    const itemsReads = calls.filter((call) => !isScrollExpression(call.expression));
    const scrollTriggers = calls.filter((call) => isScrollExpression(call.expression));
    assert.equal(itemsReads.length, 3);
    assert.equal(scrollTriggers.length, 2, "a scroll must occur BETWEEN reads, not after the stabilizing read");
  } finally {
    uninstall();
  }
});

test("F5: cap exhaustion without ever stabilizing is a hard failure, never a silent partial", async () => {
  let round = 0;
  const { uninstall } = installScriptedCdpDriver({
    evaluate: (expression) => {
      if (isScrollExpression(expression)) return "true";
      round += 1;
      // Grows forever -- never produces two identical consecutive reads.
      const items = Array.from({ length: round }, (_, i) => rawIndexItem({
        providerEventId: `e${i}`, title: `赛事${i}`, startTime: "2026-08-18",
      }));
      return JSON.stringify(items);
    },
  });
  try {
    await assert.rejects(
      enumerateVisibleTournamentIndexItems(9222, { maxScrolls: 2, itemCeiling: 100 }),
      /enumeration_did_not_stabilize/,
    );
  } finally {
    uninstall();
  }
});

test("F5: growth in NON-completed rows prevents a premature stability break on the completed subset", async () => {
  // The completed subset (赛事一) is IDENTICAL on both reads; only a 进行中 row is added between
  // them. A signature computed over completed-only items would have wrongly called this stable
  // after the first read.
  const reads = [
    [rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18", status: "已结束" })],
    [
      rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18", status: "已结束" }),
      rawIndexItem({ providerEventId: "e2", title: "赛事二", startTime: "2026-08-20", status: "进行中" }),
    ],
    [
      rawIndexItem({ providerEventId: "e1", title: "赛事一", startTime: "2026-08-18", status: "已结束" }),
      rawIndexItem({ providerEventId: "e2", title: "赛事二", startTime: "2026-08-20", status: "进行中" }),
    ],
  ];
  let itemsCallCount = 0;
  const { uninstall } = installScriptedCdpDriver({
    evaluate: (expression) => {
      if (isScrollExpression(expression)) return "true";
      const response = JSON.stringify(reads[Math.min(itemsCallCount, reads.length - 1)]);
      itemsCallCount += 1;
      return response;
    },
  });
  try {
    const items = await enumerateVisibleTournamentIndexItems(9222, { maxScrolls: 10, itemCeiling: 100 });
    assert.equal(itemsCallCount, 3, "the 进行中 row's arrival between reads 1 and 2 must force a third read, not an early stop");
    assert.deepEqual(items.map((item) => item.title), ["赛事一"], "the returned set is still completed-only");
  } finally {
    uninstall();
  }
});

test("filterTournamentsWithinWindow bounds by asOf and windowDays inclusively", () => {
  const items = [
    { title: "边界内", startTime: "2026-08-15" },
    { title: "边界外", startTime: "2026-08-10" },
    { title: "未来", startTime: "2026-08-21" },
  ];
  const selected = filterTournamentsWithinWindow(items, "2026-08-20", 5);
  assert.deepEqual(selected.map((item) => item.title), ["边界内"]);
  assert.throws(() => filterTournamentsWithinWindow(items, "not-a-date", 5), /--as-of/);
  assert.throws(() => filterTournamentsWithinWindow(items, "2026-08-20", 0), /--window-days/);
});

test("selectTournamentByKey selects exactly one event and fails closed on zero or ambiguous matches", () => {
  const items = enumerateCompletedTournaments([
    { title: "赛事 A", startTime: "2026-08-18", status: "已结束" },
    { title: "赛事 B", startTime: "2026-08-19", status: "已结束" },
  ]);
  const key = selectionKeyForTournament({ title: "赛事 A", startTime: "2026-08-18" });
  assert.equal(selectTournamentByKey(items, key).title, "赛事 A");
  assert.throws(() => selectTournamentByKey(items, "jihuanshe:tournament:does-not-exist"), /event_key_not_found/);
  assert.throws(() => selectTournamentByKey(items, ""), /--event-key/);
});

test("assertSelectedEventIdentity verifies identity again on the detail page and rejects a mismatch", () => {
  const expectedKey = selectionKeyForTournament({ providerEventId: "42" });
  assert.doesNotThrow(() => assertSelectedEventIdentity(expectedKey, { providerEventId: "42" }));
  assert.throws(
    () => assertSelectedEventIdentity(expectedKey, { providerEventId: "99" }),
    /event_identity_mismatch/,
  );
});

// F3/S3 (fix round 1): tapAndVerifyTournamentDetail driven end to end via the fake-CDP seam plus
// a small fake-adb executable (for dumpUi/tap only -- no network, no real emulator). S3: the
// pre-fix suite never called this function at all, so a mutant deleting the whole revalidation
// step went undetected; each test below throws unless the revalidation genuinely runs.
const DETAIL_TARGET_TITLE = "tournamentPack/pages/detail/detail";

function pageStateResponse(text, activeTab = "") {
  return JSON.stringify({ text, activeTab });
}

function isPageStateExpression(expression) {
  return expression.includes("activeTab");
}

test("F3: fails closed (event_identity_unverifiable) when no provider id exists anywhere and the detail page text does not confirm the selection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ title: "赛事甲", startTime: "2026-08-18" });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail" }, // no id-shaped query param
    ],
    evaluate: (expression) => (isPageStateExpression(expression)
      ? pageStateResponse("完全不相关的赛事\n2026-01-01")
      : "true"),
  });
  try {
    await assert.rejects(
      tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected),
      /event_identity_unverifiable/,
    );
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: succeeds when no provider id exists anywhere but the detail page's OWN text independently confirms title and start time", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ title: "赛事甲", startTime: "2026-08-18" });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail" },
    ],
    evaluate: (expression) => (isPageStateExpression(expression)
      ? pageStateResponse("详情\n赛事甲\n2026-08-18\n航海王简中")
      : "true"),
  });
  try {
    await assert.doesNotReject(tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected));
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: rejects (event_identity_mismatch) when the detail page's own route id disagrees with the selected event's id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ providerEventId: "42", title: "赛事甲", startTime: "2026-08-18" });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail?id=99" }, // disagrees with "42"
    ],
    evaluate: () => "true",
  });
  try {
    await assert.rejects(
      tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected),
      /event_identity_mismatch/,
    );
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

// F3 completion (fix round 2): MIXED-id paths were still tautological. Reviewer probes: index
// has a real id but the detail route has none -> previously ACCEPTED via
// `detailProviderEventId ?? selectedItem.providerEventId` falling back to an echo of the very
// value under test, with ZERO independent read; index has no id but the detail route has one ->
// previously ACCEPTED via the early "nothing to disagree with" return, also with zero
// independent read. Both must now require the detail page's OWN text to confirm title/startTime.
test("F3: mixed paths -- index has an id but the detail route does not -- rejects on unrelated detail text (was previously an echo-accept)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ providerEventId: "42", title: "赛事甲", startTime: "2026-08-18" });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail" }, // NO id-shaped query param
    ],
    evaluate: (expression) => (isPageStateExpression(expression)
      ? pageStateResponse("完全不相关的赛事\n2026-01-01") // does NOT confirm 赛事甲/2026-08-18
      : "true"),
  });
  try {
    await assert.rejects(
      tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected),
      /event_identity_unverifiable/,
    );
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: mixed paths -- index has no id but the detail route does -- rejects on unrelated detail text (was previously an echo-accept)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ title: "赛事甲", startTime: "2026-08-18" }); // no providerEventId
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail?id=99" }, // detail HAS an id; index does not
    ],
    evaluate: (expression) => (isPageStateExpression(expression)
      ? pageStateResponse("完全不相关的赛事\n2026-01-01")
      : "true"),
  });
  try {
    await assert.rejects(
      tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected),
      /event_identity_unverifiable/,
    );
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: mixed paths -- succeeds when the detail page's own text DOES confirm title/startTime, even with only one side carrying an id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ providerEventId: "42", title: "赛事甲", startTime: "2026-08-18" });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [
      { title: "pages/tournaments/index", url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail" }, // no id-shaped query param
    ],
    evaluate: (expression) => (isPageStateExpression(expression)
      ? pageStateResponse("详情\n赛事甲\n2026-08-18\n航海王简中")
      : "true"),
  });
  try {
    await assert.doesNotReject(tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected));
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("F3: restores hit/viewport safety -- a covered or stale DOM target (hit:false) is refused before any tap is sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f3-test-"));
  const adb = fakeAdbScript(directory);
  const selected = rawIndexItem({ providerEventId: "42", title: "赛事甲", startTime: "2026-08-18", hit: false });
  selected.selectionKey = selectionKeyForTournament(selected);
  const { uninstall } = installScriptedCdpDriver({
    targets: [{ title: "pages/tournaments/index", url: "app://index" }, { title: DETAIL_TARGET_TITLE, url: "app://detail?id=42" }],
    evaluate: () => "true",
  });
  try {
    await assert.rejects(
      tapAndVerifyTournamentDetail(adb, 9222, { homeTimeout: 5 }, selected),
      /covered|stale|target/i,
    );
    assert.equal(requireExists(join(directory, "taps.log")), false, "a covered/stale target must never be tapped");
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

// F6/S5 (fix round 1): collectTournamentBatch driven end to end (index enumeration, tap,
// detail/results/decks tab reads, KEYCODE_BACK, RE-enumeration, second event) via the fake-adb +
// fake-CDP harness. Bypasses withAvdDriveLock/launchHome (already covered by
// jihuanshe_lifecycle.test.mjs and the reauthOwnedAvd tests respectively) and calls
// collectTournamentBatch directly with a minimal lease -- the "one lock across the whole batch"
// half of S5 is proven separately in jihuanshe_lifecycle.test.mjs
// ("withAvdDriveLock holds exactly ONE lock across every item of a multi-event batch"); this
// test's job is the OTHER half: per-event sourceRef survives emission, and F6's stale-rect fix.
function detailTexts(identity, resultsSuffix, decksSuffix) {
  return {
    detail: `详情\n卡组\n赛果\n${identity.title}\n${identity.startTime}\n航海王简中\n已结束`,
    results: `${identity.title}\n航海王简中\n${identity.startTime}\n瑞士轮\n选手\n胜平负\n分数\n${resultsSuffix}`,
    decks: `${identity.title}\n航海王简中\n${identity.startTime}\n卡组分布\n卡组\n数量\n占比\n${decksSuffix}`,
  };
}

// Captures what collectTournamentBatch/collectTournamentByKey/collectMarket would have printed
// via the injectable result-emitter seam -- NEVER via monkey-patching process.stdout.write
// directly: that was tried first and it raced with node --test's own reporter (which also writes
// through process.stdout), silently dropping OTHER tests from the run with no error at all.
async function captureEmittedResult(run) {
  let captured;
  const uninstall = installResultEmitterForTest((envelope) => {
    captured = envelope;
  });
  try {
    await run();
  } finally {
    uninstall();
  }
  return captured;
}

test("F6/S5: collectTournamentBatch captures two events with distinct sourceRefs, re-enumerating (fresh rects) after KEYCODE_BACK", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-batch-test-"));
  const adb = fakeAdbScript(directory);
  const homeXml = '<hierarchy><node text="赛事大厅" content-desc="" clickable="true" bounds="[0,0][200,100]"/></hierarchy>';

  // enumerateCompletedTournaments sorts newest-startTime-first, so event1 (processed FIRST by
  // collectTournamentBatch's loop) must carry the LATER date and event2 (processed second, the
  // one whose stale-rect fix this test targets) the earlier one.
  const event1 = rawIndexItem({
    providerEventId: "e1", title: "合成赛事一", startTime: "2026-08-19", hit: true,
  });
  event1.selectionKey = selectionKeyForTournament(event1);
  // event2 starts UNHITTABLE in the initial read (as if off-screen/covered before any
  // navigation) and only becomes hittable in the read taken AFTER KEYCODE_BACK -- this is what
  // distinguishes "used a fresh re-enumeration" from "trusted the stale initial rect": the
  // pre-fix code would feed decodeDomTapTarget the INITIAL (hit:false) copy and throw.
  const event2Initial = rawIndexItem({
    providerEventId: "e2", title: "合成赛事二", startTime: "2026-08-18", hit: false,
  });
  event2Initial.selectionKey = selectionKeyForTournament(event2Initial);
  const event2Fresh = rawIndexItem({
    providerEventId: "e2", title: "合成赛事二", startTime: "2026-08-18", hit: true,
    rect: { left: 500, top: 500, width: 200, height: 60 }, // deliberately different position
  });
  event2Fresh.selectionKey = event2Initial.selectionKey;

  const texts1 = detailTexts(event1, "1st\n甲\n3-0-0\n9", "合成红艾斯\n1\n100%\n卡组列表\n名次\n选手\n1st\n甲\n合成红艾斯");
  const texts2 = detailTexts(event2Initial, "1st\n乙\n3-0-0\n9", "合成黑黄蒂奇\n1\n100%\n卡组列表\n名次\n选手\n1st\n乙\n合成黑黄蒂奇");

  // indexReadCount becomes 1 before event1's own tap, and 2 right after the single
  // back-navigation between event1 and event2 -- i.e. it always tells us which event's detail
  // page is currently open. activeDetailTab resets to 详情 on every fresh index read, since that
  // always immediately precedes tapping into a (new) detail page.
  let indexReadCount = 0;
  let activeDetailTab = "详情";
  const INDEX_TARGET_TITLE = "pages/tournaments/index";
  // F3 completion (fix round 2): the detail target's url now carries the CURRENT event's real
  // id (derived from the same indexReadCount episode tracking used for texts/tabs below), so
  // this integration test exercises the genuine two-sided id-agreement path in
  // tapAndVerifyTournamentDetail rather than the id-absent echo path a static "app://detail"
  // (with no query param) would ride.
  const { uninstall } = installScriptedCdpDriver({
    targets: () => [
      { title: INDEX_TARGET_TITLE, url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: `app://detail?id=${indexReadCount <= 2 ? "e1" : "e2"}` },
    ],
    evaluate: (expression, callIndex, target) => {
      if (isScrollExpression(expression)) return "true";
      if (expression.includes("wx-navigator")) {
        indexReadCount += 1;
        activeDetailTab = "详情";
        // enumerateVisibleTournamentIndexItems needs TWO CONSECUTIVE IDENTICAL reads to confirm
        // stability, even within a single enumeration episode -- so reads 1-2 (the initial
        // episode, before event1) must return the SAME data as each other, and reads 3-4 (the
        // re-enumeration episode, after the one back-navigation) must likewise agree with each
        // other while differing from the first episode.
        return JSON.stringify(indexReadCount <= 2 ? [event1, event2Initial] : [event1, event2Fresh]);
      }
      if (expression.includes('"赛果"')) {
        activeDetailTab = "赛果";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (expression.includes('"卡组"')) {
        activeDetailTab = "卡组";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (isPageStateExpression(expression)) {
        if (target?.title === INDEX_TARGET_TITLE) return pageStateResponse("航海王简中\n占位");
        const currentTexts = indexReadCount <= 2 ? texts1 : texts2;
        if (activeDetailTab === "赛果") return pageStateResponse(currentTexts.results, "赛果");
        if (activeDetailTab === "卡组") return pageStateResponse(currentTexts.decks, "卡组");
        return pageStateResponse(currentTexts.detail, "详情");
      }
      return "true";
    },
  });
  try {
    const lease = {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    };
    const options = {
      devtoolsPort: 9222, homeTimeout: 5, asOf: "2026-08-20", windowDays: 30, itemCeiling: 100, maxScrolls: 10,
    };
    const printed = await captureEmittedResult(() => collectTournamentBatch(adb, homeXml, options, lease));
    assert.equal(printed.schemaVersion, 2);
    assert.equal(printed.surface, "tournament-batch");
    assert.equal(printed.data.events.length, 2);
    assert.equal(printed.data.events[0].sourceRef.providerEventId, "e1");
    assert.equal(printed.data.events[1].sourceRef.providerEventId, "e2");
    assert.notDeepEqual(printed.data.events[0].sourceRef, printed.data.events[1].sourceRef);
    // 2 reads per enumeration episode (stability needs two consecutive identical reads) x 2
    // episodes (the initial enumeration, and exactly one re-enumeration after the single
    // back-navigation between the two events) = 4.
    assert.equal(indexReadCount, 4, "must re-enumerate exactly once after the single back-navigation between two events");

    // F8 (fix round 1, controller ruling, done last): the batch wrapper carries the requested
    // window, using exactly the two fields Task 7's (now-amended) normalizer shape-validates.
    assert.deepEqual(printed.data.requestWindow, { asOf: "2026-08-20", windowDays: 30 });
    const context = {
      environment: {
        edition: "SC", metagameRegion: "CN", language: "zh-Hans", formatId: "standard-block2-op16", timeZone: "Asia/Shanghai",
      },
      formatId: "standard-block2-op16",
      timeZone: "Asia/Shanghai",
      asOf: "2026-08-20",
      parserVersion: "jihuanshe-capture-v1",
      mapping: { mappingVersion: "test-v1", entries: {} },
    };
    // Genuinely round-trips the EXACT bytes collectTournamentBatch would have printed through
    // Task 7's real, unmodified normalizer -- proving requestWindow's shape is accepted now that
    // Task 7's concurrent amendment has landed (BATCH_DATA_FIELDS/assertRequestWindow), not just
    // asserted against Task 8's own idea of the contract.
    const snapshots = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(printed)), context);
    assert.equal(snapshots.length, 2);
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

// F6 completion (fix round 2): the fail-closed leg (the selected event's key is genuinely ABSENT
// -- not merely unhittable, but gone entirely -- from the post-back-navigation re-enumeration)
// had no test at all; three separate mutants (fallback to the stale initial item, delete the
// guard, rename the thrown code string) all left the round-1 suite green. This test makes event2
// vanish completely from the SECOND enumeration episode (rather than merely starting
// hit:false and becoming hit:true, as the F6 stale-rect test does) and asserts the exact thrown
// code string plus that event2 was never tapped.
test("F6: the selected event's key genuinely disappearing after re-enumeration fails closed (event_key_not_found), never tapping it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f6-vanish-test-"));
  const adb = fakeAdbScript(directory);
  const homeXml = '<hierarchy><node text="赛事大厅" content-desc="" clickable="true" bounds="[0,0][200,100]"/></hierarchy>';

  const event1 = rawIndexItem({
    providerEventId: "e1", title: "合成赛事一", startTime: "2026-08-19", hit: true,
  });
  event1.selectionKey = selectionKeyForTournament(event1);
  const event2 = rawIndexItem({
    providerEventId: "e2", title: "合成赛事二", startTime: "2026-08-18", hit: true,
  });
  event2.selectionKey = selectionKeyForTournament(event2);

  const texts1 = detailTexts(event1, "1st\n甲\n3-0-0\n9", "合成红艾斯\n1\n100%\n卡组列表\n名次\n选手\n1st\n甲\n合成红艾斯");

  let indexReadCount = 0;
  let activeDetailTab = "详情";
  const INDEX_TARGET_TITLE = "pages/tournaments/index";
  const { uninstall } = installScriptedCdpDriver({
    targets: () => [
      { title: INDEX_TARGET_TITLE, url: "app://index" },
      { title: DETAIL_TARGET_TITLE, url: "app://detail?id=e1" },
    ],
    evaluate: (expression, callIndex, target) => {
      if (isScrollExpression(expression)) return "true";
      if (expression.includes("wx-navigator")) {
        indexReadCount += 1;
        activeDetailTab = "详情";
        // Episode 1 (reads 1-2): both events visible. Episode 2 (reads 3-4, after the one
        // back-navigation): event2 has vanished entirely -- not hit:false, genuinely absent.
        return JSON.stringify(indexReadCount <= 2 ? [event1, event2] : [event1]);
      }
      if (expression.includes('"赛果"')) {
        activeDetailTab = "赛果";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (expression.includes('"卡组"')) {
        activeDetailTab = "卡组";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (isPageStateExpression(expression)) {
        if (target?.title === INDEX_TARGET_TITLE) return pageStateResponse("航海王简中\n占位");
        if (activeDetailTab === "赛果") return pageStateResponse(texts1.results, "赛果");
        if (activeDetailTab === "卡组") return pageStateResponse(texts1.decks, "卡组");
        return pageStateResponse(texts1.detail, "详情");
      }
      return "true";
    },
  });
  try {
    const lease = {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    };
    const options = {
      devtoolsPort: 9222, homeTimeout: 5, asOf: "2026-08-20", windowDays: 30, itemCeiling: 100, maxScrolls: 10,
    };
    await assert.rejects(
      collectTournamentBatch(adb, homeXml, options, lease),
      (error) => {
        assert.match(error.message, /event_key_not_found/);
        return true;
      },
    );
    const tapsLogPath = join(directory, "taps.log");
    // event1 completes fully (one tap into its detail page); event2's tap must never happen.
    const tapCount = requireExists(tapsLogPath) ? readFileSync(tapsLogPath, "utf8").trim().split("\n").filter(Boolean).length : 0;
    // event1's full capture taps exactly 4 times (open 赛事大厅, tap into its detail page, then
    // switch to 赛果 and 卡组) -- if event2 had ALSO been (incorrectly) tapped, there would be at
    // least 3 more (its own detail-open + two tab switches), for 7+. Exactly 4 proves event2's
    // key-not-found failure happened BEFORE any attempt to tap it.
    assert.equal(tapCount, 4, "event2 must never be tapped once its key is gone after re-enumeration");
  } finally {
    uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

// F10 (fix round 1): an earlier report claimed "collect tournaments is completely unchanged" by
// Task 8; it was not -- launchMode's value vocabulary had silently changed from the legacy
// "attached_existing"/"headless" pair to lease.launchMode's new "visible"/"headless" pair. Fixed
// by restoring the exact legacy mapping for THIS diagnostic specifically (new v2 surfaces keep
// the new vocabulary). This test drives collectTournaments end to end via the same fake-adb +
// fake-CDP harness as the batch test above, using installLegacyEmitterForTest instead of
// stdout-patching for the same reason captureEmittedResult exists.
test("F10: collect tournaments (legacy diagnostic) reports launchMode using the ORIGINAL attached_existing/headless vocabulary, not lease.launchMode's new one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-f10-test-"));
  const adb = fakeAdbScript(directory);
  const homeXml = '<hierarchy><node text="赛事大厅" content-desc="" clickable="true" bounds="[0,0][200,100]"/></hierarchy>';
  const event = rawIndexItem({ providerEventId: "e1", title: "合成赛事一", startTime: "2026-08-18" });
  const texts = detailTexts(event, "1st\n甲\n3-0-0\n9", "合成红艾斯\n1\n100%\n卡组列表\n名次\n选手\n1st\n甲\n合成红艾斯");
  const INDEX_TARGET_TITLE = "pages/tournaments/index";
  let activeDetailTab = "详情";
  const { uninstall: uninstallCdp } = installScriptedCdpDriver({
    targets: [{ title: INDEX_TARGET_TITLE, url: "app://index" }, { title: DETAIL_TARGET_TITLE, url: "app://detail?id=e1" }],
    evaluate: (expression, callIndex, target) => {
      if (isScrollExpression(expression)) return "true";
      if (expression.includes("tour_item")) return JSON.stringify([event]);
      if (expression.includes('"赛果"')) {
        activeDetailTab = "赛果";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (expression.includes('"卡组"')) {
        activeDetailTab = "卡组";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (isPageStateExpression(expression)) {
        if (target?.title === INDEX_TARGET_TITLE) return pageStateResponse("航海王简中\n占位");
        if (activeDetailTab === "赛果") return pageStateResponse(texts.results, "赛果");
        if (activeDetailTab === "卡组") return pageStateResponse(texts.decks, "卡组");
        return pageStateResponse(texts.detail, "详情");
      }
      return "true";
    },
  });
  try {
    const lease = {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    };
    const options = { devtoolsPort: 9222, homeTimeout: 5, itemCeiling: 100, maxScrolls: 10 };
    let captured;
    const uninstallEmitter = installLegacyEmitterForTest((envelope) => { captured = envelope; });
    try {
      await collectTournaments(adb, homeXml, options, lease);
    } finally {
      uninstallEmitter();
    }
    assert.equal(captured.schemaVersion, 1);
    assert.equal(captured.emulator.launchMode, "attached_existing");
    assert.notEqual(captured.emulator.launchMode, lease.launchMode);
  } finally {
    uninstallCdp();
    rmSync(directory, { recursive: true, force: true });
  }
});

// Viewport reachability (fix round 2, NEW finding, controller ruling): a freshly re-enumerated
// item can be genuinely present (a real selectionKey match) yet still positioned OUTSIDE the
// current viewport -- KEYCODE_BACK resets scroll position while the enumeration that follows can
// report a rect from further down the (now scrolled-away-from) list. decodeDomTapTarget would
// throw "outside the visible viewport bounds" on that rect. Fixed: scroll the item into view
// (reusing the enumeration loop's own scroll trigger), bounded by maxScrolls, before ever tapping.
function singleEventBatchHarness({ topSequence }) {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-viewport-test-"));
  const adb = fakeAdbScript(directory);
  const homeXml = '<hierarchy><node text="赛事大厅" content-desc="" clickable="true" bounds="[0,0][200,100]"/></hierarchy>';
  const event = rawIndexItem({
    providerEventId: "e1", title: "合成赛事一", startTime: "2026-08-18", hit: true,
  });
  event.selectionKey = selectionKeyForTournament(event);
  const texts = detailTexts(event, "1st\n甲\n3-0-0\n9", "合成红艾斯\n1\n100%\n卡组列表\n名次\n选手\n1st\n甲\n合成红艾斯");

  let itemsReadCount = 0;
  let activeDetailTab = "详情";
  const INDEX_TARGET_TITLE = "pages/tournaments/index";
  const driver = installScriptedCdpDriver({
    targets: [{ title: INDEX_TARGET_TITLE, url: "app://index" }, { title: DETAIL_TARGET_TITLE, url: "app://detail?id=e1" }],
    evaluate: (expression, callIndex, target) => {
      if (isScrollExpression(expression)) return "true";
      if (expression.includes("wx-navigator")) {
        itemsReadCount += 1;
        activeDetailTab = "详情";
        // Reads 1-2: the two stability-confirming enumeration reads (same rect both times, so
        // they agree and enumeration returns promptly). Reads 3+: scrollSelectedItemIntoView's
        // OWN re-reads, one per scroll -- `topSequence[read-3]` (or the last entry once
        // exhausted) supplies each round's top, letting each test script exactly how many
        // scrolls it takes (or never) to become reachable.
        const top = itemsReadCount <= 2
          ? topSequence[0]
          : topSequence[Math.min(itemsReadCount - 3, topSequence.length - 1)];
        const withRect = { ...event, rect: { ...event.rect, top } };
        return JSON.stringify([withRect]);
      }
      if (expression.includes('"赛果"')) {
        activeDetailTab = "赛果";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (expression.includes('"卡组"')) {
        activeDetailTab = "卡组";
        return JSON.stringify({ rect: { left: 0, top: 0, width: 50, height: 20 }, viewport: { width: 1080, height: 2400 }, hit: true });
      }
      if (isPageStateExpression(expression)) {
        if (target?.title === INDEX_TARGET_TITLE) return pageStateResponse("航海王简中\n占位");
        if (activeDetailTab === "赛果") return pageStateResponse(texts.results, "赛果");
        if (activeDetailTab === "卡组") return pageStateResponse(texts.decks, "卡组");
        return pageStateResponse(texts.detail, "详情");
      }
      return "true";
    },
  });
  return { directory, adb, homeXml, driver };
}

test("viewport reachability: an item initially below the fold is scrolled into view, then tapped at the fresh rect", async () => {
  // Enumeration sees the item at top:2500 (outside a 2400-tall viewport); after ONE scroll,
  // scrollSelectedItemIntoView's re-read reports it at top:500 (now inside).
  const { directory, adb, homeXml, driver } = singleEventBatchHarness({ topSequence: [2500, 500] });
  try {
    const lease = {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    };
    const options = {
      devtoolsPort: 9222, homeTimeout: 5, asOf: "2026-08-20", windowDays: 30, itemCeiling: 100, maxScrolls: 10,
    };
    const printed = await captureEmittedResult(() => collectTournamentBatch(adb, homeXml, options, lease));
    assert.equal(printed.data.events.length, 1);
    assert.equal(printed.data.events[0].sourceRef.providerEventId, "e1");
    const tapsLogPath = join(directory, "taps.log");
    assert.ok(requireExists(tapsLogPath), "the item must actually have been tapped once reachable");
  } finally {
    driver.uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("viewport reachability: an item that never becomes reachable fails closed (event_unreachable), with zero taps", async () => {
  // Every read -- enumeration AND every scroll-into-view attempt -- reports the SAME
  // out-of-viewport top, so it can never be tapped; maxScrolls is small so the test is fast.
  const { directory, adb, homeXml, driver } = singleEventBatchHarness({ topSequence: [2500] });
  try {
    const lease = {
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    };
    const options = {
      devtoolsPort: 9222, homeTimeout: 5, asOf: "2026-08-20", windowDays: 30, itemCeiling: 100, maxScrolls: 3,
    };
    await assert.rejects(
      collectTournamentBatch(adb, homeXml, options, lease),
      /event_unreachable/,
    );
    // Exactly ONE tap is expected: opening 赛事大厅 from the home screen, which happens before
    // any per-event logic runs. The unreachable item itself must never be tapped -- if it had
    // been, there would be a second tap logged (into its detail page).
    const tapsLogPath = join(directory, "taps.log");
    const tapCount = requireExists(tapsLogPath) ? readFileSync(tapsLogPath, "utf8").trim().split("\n").filter(Boolean).length : 0;
    assert.equal(tapCount, 1, "the unreachable item itself must never be tapped");
  } finally {
    driver.uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

function typedTournamentFixture() {
  return {
    identity: {
      title: "合成赛事一", startTime: "2026-08-18", status: "已结束", game: "航海王简中",
    },
    results: {
      activeTab: "赛果",
      text: "合成赛事一\n航海王简中\n2026-08-18\n瑞士轮\n选手\n胜平负\n分数"
        + "\n1st\n甲\n3-0-0\n9\n2nd\n乙\n2-1-0\n6",
    },
    decks: {
      activeTab: "卡组",
      text: "合成赛事一\n航海王简中\n2026-08-18\n卡组分布\n卡组\n数量\n占比"
        + "\n合成红艾斯\n1\n50%\n合成黑黄蒂奇\n1\n50%"
        + "\n卡组列表\n名次\n选手\n1st\n甲\n合成红艾斯\n2nd\n乙\n合成黑黄蒂奇",
    },
  };
}

test("buildTypedTournamentEventData produces the exact typed shape jihuanshe_normalize.mjs (Task 7) requires", () => {
  const typed = buildTypedTournamentEventData(typedTournamentFixture());

  assert.deepEqual(typed.identity, {
    title: "合成赛事一",
    game: "航海王简中",
    status: "已结束",
    startLabel: "2026-08-18",
    formatLabel: "标准赛",
  });
  assert.equal(typed.results.activeTab, "赛果");
  assert.deepEqual(typed.results.rows, [
    {
      providerRowId: "row-1", rank: 1, record: "3-0-0", score: 9, joinToken: "甲", rawArchetypeLabel: "合成红艾斯",
    },
    {
      providerRowId: "row-2", rank: 2, record: "2-1-0", score: 6, joinToken: "乙", rawArchetypeLabel: "合成黑黄蒂奇",
    },
  ]);
  assert.equal(typed.decks.activeTab, "卡组");
  assert.deepEqual(typed.decks.distributionRows, [
    { rawArchetypeLabel: "合成红艾斯", count: 1, percentageLabel: "50%" },
    { rawArchetypeLabel: "合成黑黄蒂奇", count: 1, percentageLabel: "50%" },
  ]);
  assert.deepEqual(typed.decks.entrantRows, [
    { providerRowId: "entrant-1", joinToken: "甲", rawArchetypeLabel: "合成红艾斯" },
    { providerRowId: "entrant-2", joinToken: "乙", rawArchetypeLabel: "合成黑黄蒂奇" },
  ]);
});

test("buildTypedTournamentEventData throws rather than silently join-failing when a results player has no matching entrant", () => {
  const fixture = typedTournamentFixture();
  fixture.decks.text = fixture.decks.text.replace("2nd\n乙\n合成黑黄蒂奇", "2nd\n丙\n合成黑黄蒂奇");
  assert.throws(
    () => buildTypedTournamentEventData(fixture),
    /archetype_join_failed/,
  );
});

test("buildTypedTournamentEventData's redacted archetype_join_failed error never leaks the raw player name", () => {
  const fixture = typedTournamentFixture();
  fixture.decks.text = fixture.decks.text.replace("2nd\n乙\n合成黑黄蒂奇", "2nd\n丙\n合成黑黄蒂奇");
  try {
    buildTypedTournamentEventData(fixture);
    assert.fail("expected archetype_join_failed to throw");
  } catch (error) {
    assert.doesNotMatch(error.message, /乙|丙/);
  }
});

test("buildTypedMarketData produces the exact pinned shape (no raw UI node dump)", () => {
  const nodes = [
    { text: "航海王总行情", contentDescription: "" },
    { text: "合成红艾斯 领路人", contentDescription: "" },
    { text: "¥128.00", contentDescription: "" },
    { text: "合成黑黄蒂奇 船长", contentDescription: "" },
    { text: "¥256.50", contentDescription: "" },
  ];
  const data = buildTypedMarketData(nodes, { searchLabel: "合成", filterLabels: ["简中"], sortLabel: "价格降序" });

  assert.deepEqual(data.identity, { game: "航海王简中" });
  assert.deepEqual(data.query, { searchLabel: "合成", filterLabels: ["简中"], sortLabel: "价格降序" });
  assert.deepEqual(data.rows, [
    { providerRowId: "row-1", rawCardLabel: "合成红艾斯 领路人", observedPriceLabel: "¥128.00" },
    { providerRowId: "row-2", rawCardLabel: "合成黑黄蒂奇 船长", observedPriceLabel: "¥256.50" },
  ]);
  // Pinned by the Task 7/8 contract: visibleRowCount must equal rows.length exactly, and
  // paginationComplete is always false for a viewport-only scrape.
  assert.equal(data.visibleRowCount, data.rows.length);
  assert.equal(data.paginationComplete, false);
  assert.equal(JSON.stringify(data).includes("nodes"), false);
});

test("a market CaptureResult v2 envelope built from typed data normalizes cleanly through Task 7's frozen normalizer", () => {
  // This is exactly the gap a shape-only assertion would miss: buildTypedMarketData's FIRST
  // draft omitted visibleRowCount/paginationComplete entirely, which the unit test above (only
  // checking identity/query/rows) did not catch -- only feeding the envelope through the real
  // normalizer surfaced it (normalizeMarketCapture's own normalization_failed check).
  const nodes = [
    { text: "航海王总行情", contentDescription: "" },
    { text: "合成红艾斯 领路人", contentDescription: "" },
    { text: "¥128.00", contentDescription: "" },
  ];
  const envelope = buildCaptureEnvelope({
    surface: "market",
    sourceRef: { sanitizedRoute: "app:market" },
    data: buildTypedMarketData(nodes, { searchLabel: "合成", filterLabels: [], sortLabel: "默认排序" }),
    lifecycle: buildLifecycleMetadata({
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    }),
  });
  const context = {
    environment: {
      edition: "SC", metagameRegion: "CN", language: "zh-Hans", formatId: "standard-block2-op16", timeZone: "Asia/Shanghai",
    },
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
    asOf: "2026-08-20",
    parserVersion: "jihuanshe-capture-v1",
    mapping: { mappingVersion: "test-v1", entries: {} },
  };

  const [snapshot] = normalizeJiHuanSheCapture(Buffer.from(JSON.stringify(envelope)), context);
  assert.equal(snapshot.kind, "market");
  assert.equal(snapshot.data.visibleRowCount, 1);
  assert.equal(snapshot.data.paginationComplete, false);
  assert.equal(snapshot.data.scope, "visible-viewport");
  assert.equal(snapshot.data.rows[0].currency, "CNY");
  assert.equal(snapshot.data.rows[0].observedPrice, 128);
});

test("buildTypedMarketData throws rather than emitting zero rows when no priced line is found", () => {
  assert.throws(
    () => buildTypedMarketData([{ text: "航海王总行情", contentDescription: "" }], {}),
    /no recognizable/,
  );
});

// F9 (fix round 1): the reviewer's exact probe -- a phone-number line and an
// "Authorization: Bearer ..."-shaped line, each immediately preceding a ¥ line -- must both be
// dropped rather than emitted verbatim as rawCardLabel. A legitimate card label sharing the rest
// of the node list must still come through untouched.
test("F9: drops a row whose label looks like a phone number or an Authorization header, keeping legitimate rows", () => {
  const nodes = [
    { text: "13800138000", contentDescription: "" }, // phone-number-shaped
    { text: "¥50.00", contentDescription: "" },
    { text: "Authorization: Bearer abc123", contentDescription: "" },
    { text: "¥60.00", contentDescription: "" },
    { text: "合成红艾斯 领路人", contentDescription: "" },
    { text: "¥128.00", contentDescription: "" },
  ];
  const rows = buildTypedMarketRows(nodes);
  assert.deepEqual(rows, [
    { providerRowId: "row-1", rawCardLabel: "合成红艾斯 领路人", observedPriceLabel: "¥128.00" },
  ]);
  assert.equal(rows.some((row) => row.rawCardLabel.includes("Bearer") || /^\d+$/.test(row.rawCardLabel)), false);
});

test("F9: rejects a label over the length cap and a long opaque token-shaped label", () => {
  // Padded with spaces (not repeated bare characters) so the length-cap boundary is exercised
  // independently of the opaque-token shape check below. The un-sliced template is well over 61
  // characters so slicing to 60 vs 61 genuinely produces two different-length strings.
  const longLabel = `合成红艾斯 领路人 ${"x ".repeat(40)}`;
  assert.ok(longLabel.length > 61);
  assert.equal(looksLikeMarketCardLabel(longLabel.slice(0, 61)), false);
  assert.equal(looksLikeMarketCardLabel(longLabel.slice(0, 60)), true);
  assert.equal(looksLikeMarketCardLabel("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xyz123456"), false);
  assert.equal(looksLikeMarketCardLabel("合成红艾斯 领路人"), true);
});

test("F9: an empty result set after dropping every row is still the pre-existing hard failure", () => {
  const nodes = [
    { text: "13800138000", contentDescription: "" },
    { text: "¥50.00", contentDescription: "" },
  ];
  assert.throws(() => buildTypedMarketRows(nodes), /no recognizable/);
});

test("buildLifecycleMetadata and buildCaptureEnvelope emit exactly the allowlisted CaptureResult v2 keys", () => {
  const lease = {
    avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 123, processStartToken: "t", launchMode: "headless", startedByInvocation: true,
  };
  const lifecycle = buildLifecycleMetadata(lease, { requested: false });
  assert.deepEqual(lifecycle, {
    state: "headless-started", launchMode: "headless", startedByInvocation: true, cleanup: { requested: false },
  });

  const envelope = buildCaptureEnvelope({
    surface: "market",
    sourceRef: { sanitizedRoute: "app:market" },
    data: { identity: { game: "航海王简中" } },
    lifecycle,
  });
  assert.deepEqual(
    Object.keys(envelope).sort(),
    ["capturedAt", "data", "lifecycle", "schemaVersion", "source", "sourceRef", "status", "surface"].sort(),
  );
  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.status, "ok");
  assert.ok(!Number.isNaN(Date.parse(envelope.capturedAt)));
});

test("a tournament CaptureResult v2 envelope built from a typed capture normalizes cleanly through Task 7's frozen normalizer", () => {
  const typed = buildTypedTournamentEventData(typedTournamentFixture());
  const envelope = buildCaptureEnvelope({
    surface: "tournament",
    sourceRef: { providerEventId: "fixture-event-001", sanitizedRoute: "app:tournament-detail" },
    data: typed,
    lifecycle: buildLifecycleMetadata({
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: false,
    }),
  });
  const bytes = Buffer.from(JSON.stringify(envelope));
  const context = {
    environment: {
      edition: "SC", metagameRegion: "CN", language: "zh-Hans", formatId: "standard-block2-op16", timeZone: "Asia/Shanghai",
    },
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
    asOf: "2026-08-20",
    parserVersion: "jihuanshe-capture-v1",
    mapping: { mappingVersion: "test-v1", entries: {} },
  };

  const [snapshot] = normalizeJiHuanSheCapture(bytes, context);
  assert.equal(snapshot.kind, "tournament_event");
  assert.equal(snapshot.data.identity.title, "合成赛事一");
  assert.equal(snapshot.source.sourceRef.providerEventId, "fixture-event-001");
  // No mapping entries were supplied, so full-field promotion correctly does not happen here --
  // this test's job is proving the SHAPE parses end to end, not exercising promotion.
  assert.equal(snapshot.coverage.status, "partial");
});

test("a batch of two typed events shares one envelope and each keeps its own sourceRef identity through Task 7's normalizer", () => {
  const first = buildTypedTournamentEventData(typedTournamentFixture());
  const second = typedTournamentFixture();
  second.identity.title = "合成赛事二";
  second.identity.startTime = "2026-08-19";
  const secondTyped = buildTypedTournamentEventData(second);

  const envelope = buildCaptureEnvelope({
    surface: "tournament-batch",
    sourceRef: { sanitizedRoute: "app:tournament-index" },
    data: {
      events: [
        { sourceRef: { providerEventId: "fixture-event-001", sanitizedRoute: "app:tournament-detail" }, data: first },
        { sourceRef: { providerEventId: "fixture-event-002", sanitizedRoute: "app:tournament-detail" }, data: secondTyped },
      ],
    },
    lifecycle: buildLifecycleMetadata({
      avd: "JiHuanShe_SC", serial: "emulator-5554", pid: 1, processStartToken: "t", launchMode: "headless", startedByInvocation: true,
    }),
  });
  const bytes = Buffer.from(JSON.stringify(envelope));
  const context = {
    environment: {
      edition: "SC", metagameRegion: "CN", language: "zh-Hans", formatId: "standard-block2-op16", timeZone: "Asia/Shanghai",
    },
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
    asOf: "2026-08-20",
    parserVersion: "jihuanshe-capture-v1",
    mapping: { mappingVersion: "test-v1", entries: {} },
  };

  const [snapshotOne, snapshotTwo] = normalizeJiHuanSheCapture(bytes, context);
  assert.equal(snapshotOne.source.sourceRef.providerEventId, "fixture-event-001");
  assert.equal(snapshotTwo.source.sourceRef.providerEventId, "fixture-event-002");
  assert.notEqual(snapshotOne.data.eventKey, snapshotTwo.data.eventKey);
});

test("parseArguments accepts the new tournament-selection and batch flags", () => {
  const single = parseArguments([
    "collect", "tournament", "--event-key", "jihuanshe:tournament:42",
  ]);
  assert.equal(single.target, "tournament");
  assert.equal(single.options.eventKey, "jihuanshe:tournament:42");

  const batch = parseArguments([
    "collect", "tournament-batch", "--as-of", "2026-08-20", "--window-days", "7", "--cleanup-started",
  ]);
  assert.equal(batch.target, "tournament-batch");
  assert.equal(batch.options.asOf, "2026-08-20");
  assert.equal(batch.options.windowDays, 7);
  assert.equal(batch.options.cleanupStarted, true);

  const list = parseArguments(["list", "tournaments", "--item-ceiling", "50"]);
  assert.equal(list.command, "list");
  assert.equal(list.target, "tournaments");
  assert.equal(list.options.itemCeiling, 50);

  assert.throws(
    () => parseArguments(["collect", "tournament-batch", "--as-of", "2026-08-20", "--window-days", "0"]),
    /windowDays/,
  );

  const withPsAndLock = parseArguments(["start", "--ps", "/fake/ps", "--lock-path", "/tmp/x.lock"]);
  assert.equal(withPsAndLock.options.ps, "/fake/ps");
  assert.equal(withPsAndLock.options.lockPath, "/tmp/x.lock");

  // --cleanup-started is a boolean flag: it must not consume the following token as its value.
  const cleanupThenTarget = parseArguments(["collect", "tournament-batch", "--cleanup-started", "--as-of", "2026-08-20", "--window-days", "1"]);
  assert.equal(cleanupThenTarget.options.cleanupStarted, true);
  assert.equal(cleanupThenTarget.options.asOf, "2026-08-20");
});
