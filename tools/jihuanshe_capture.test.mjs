#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildEmulatorArgs,
  classifyHomeUi,
  decodeDomTapTarget,
  findUiTapPoint,
  findWebViewBounds,
  isTargetMarketUi,
  mapDomPoint,
  parseEmulatorAvdName,
  parseReadyDevices,
  parseUiHierarchy,
  selectLatestCompletedTournament,
  stopEmulatorArgs,
  validateTournamentCapture,
} from "./jihuanshe_capture.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

test("CLI does not invoke the emulator executable when adb already reports emulator-5554 online", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-capture-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const adbLog = join(directory, "adb.log");
  const emulatorCalled = join(directory, "emulator-called");

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *"wait-for-device"*) exit 0 ;;
  *"get-state"*) printf 'device\\n' ;;
  *"getprop sys.boot_completed"*) printf '1\\n' ;;
  *"getprop dev.bootcomplete"*) printf '1\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf 'called\\n' > "$JHS_FAKE_EMULATOR_CALLED"
exit 91
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb",
        fakeAdb,
        "--emulator",
        fakeEmulator,
        "--avd",
        "JiHuanShe_SC",
        "--port",
        "5554",
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
    assert.equal(readFileSync(adbLog, "utf8").includes("devices"), true);
    assert.equal(requireExists(emulatorCalled), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start waits for a newly spawned headless emulator to become boot-complete", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-start-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const devicesCount = join(directory, "devices-count");
  const emulatorArgs = join(directory, "emulator-args");

  writeFileSync(fakeAdb, `#!/bin/sh
case "$*" in
  "devices")
    if [ -f "$JHS_FAKE_DEVICES_COUNT" ] && [ -f "$JHS_FAKE_EMULATOR_ARGS" ]; then
      printf 'List of devices attached\\nemulator-5554\\tdevice\\n'
    else
      printf '1\\n' > "$JHS_FAKE_DEVICES_COUNT"
      printf 'List of devices attached\\n'
    fi ;;
  *"getprop sys.boot_completed"*) printf '1\\n' ;;
  *"emu avd name"*) printf 'JiHuanShe_SC\\nOK\\n' ;;
  *"get-state"*) printf 'device\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$*" > "$JHS_FAKE_EMULATOR_ARGS"
exit 0
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--avd", "JiHuanShe_SC",
        "--port", "5554",
        "--boot-timeout", "5",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          JHS_FAKE_DEVICES_COUNT: devicesCount,
          JHS_FAKE_EMULATOR_ARGS: emulatorArgs,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, "ready");
    assert.equal(JSON.parse(result.stdout).started, true);
    const args = readFileSync(emulatorArgs, "utf8");
    assert.match(args, /-no-window/);
    assert.doesNotMatch(args, /-wipe-data|-read-only|-no-snapshot-save/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start terminates only the newly spawned emulator process when boot times out", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-boot-timeout-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const adbLog = join(directory, "adb.log");
  const emulatorPid = join(directory, "emulator.pid");
  const terminated = join(directory, "terminated");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });

  writeFileSync(fakeAdb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_ADB_LOG"
case "$*" in
  "devices") printf 'List of devices attached\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$$" > "$JHS_FAKE_EMULATOR_PID"
trap 'printf terminated > "$JHS_FAKE_TERMINATED"; exit 0' TERM INT
while :; do /bin/sleep 1; done
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
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

test("SIGTERM cleans the spawned emulator and process lock before the CLI exits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-signal-cleanup-test-"));
  const fakeAdb = join(directory, "adb");
  const fakeEmulator = join(directory, "emulator");
  const emulatorPid = join(directory, "emulator.pid");
  const terminated = join(directory, "terminated");
  const lock = join(tmpdir(), "jihuanshe-capture-emulator-5554.lock");
  let cli;

  writeFileSync(fakeAdb, `#!/bin/sh
case "$*" in
  "devices") printf 'List of devices attached\\n' ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  writeFileSync(fakeEmulator, `#!/bin/sh
printf '%s\\n' "$$" > "$JHS_FAKE_EMULATOR_PID"
trap 'printf terminated > "$JHS_FAKE_TERMINATED"; exit 0' TERM INT
while :; do /bin/sleep 1; done
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    cli = spawn(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "start",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
        "--boot-timeout", "60",
      ],
      {
        cwd: REPO_ROOT,
        stdio: "ignore",
        env: {
          ...process.env,
          JHS_FAKE_EMULATOR_PID: emulatorPid,
          JHS_FAKE_TERMINATED: terminated,
        },
      },
    );
    await waitFor(() => requireExists(emulatorPid), 5_000);
    assert.equal(cli.kill("SIGTERM"), true);
    const result = await new Promise((resolve) => {
      cli.once("exit", (code, signal) => resolve({ code, signal }));
    });
    await waitFor(() => requireExists(terminated), 5_000);

    assert.deepEqual(result, { code: null, signal: "SIGTERM" });
    assert.equal(requireExists(lock), false);
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
  const adbLog = join(directory, "adb.log");
  const emulatorCalled = join(directory, "emulator-called");

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
  writeFileSync(fakeEmulator, `#!/bin/sh
printf 'called\\n' > "$JHS_FAKE_EMULATOR_CALLED"
exit 91
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  chmodSync(fakeEmulator, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "tools/jihuanshe_capture.mjs",
        "collect", "market",
        "--adb", fakeAdb,
        "--emulator", fakeEmulator,
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

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, "reauth_required");
    assert.equal(requireExists(emulatorCalled), false);
    const log = readFileSync(adbLog, "utf8");
    assert.doesNotMatch(log, /pm clear|wipe-data/);
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
