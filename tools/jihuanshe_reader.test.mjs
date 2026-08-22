#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  CHART_EXPRESSION,
  assertScMarketContext,
  assertUiContext,
  createCleanupStack,
  assertTournamentText,
  decodeChartEvaluation,
  decodeRuntimeEvaluation,
  extractUiNodes,
  localWebSocketUrl,
  installTerminationHandlers,
  selectTarget,
  summarizeTarget,
  webViewForwardArgs,
  withWebViewForward,
} from "./jihuanshe_reader.mjs";

test("extractUiNodes preserves visible text and accessibility descriptions in screen order", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
    <hierarchy rotation="0">
      <node index="0" text="" content-desc="航海王&#10;简中" />
      <node index="1" text="商品 &amp; 效果" content-desc="" />
      <node index="2" text="" content-desc="蒙奇·D·路飞&#10;ST01-012(签)&#10;¥31,715.3" />
      <node index="3" text="隐藏价格" content-desc="¥1" visible-to-user="false" />
    </hierarchy>`;

  assert.deepEqual(extractUiNodes(xml), [
    { text: "", contentDescription: "航海王\n简中" },
    { text: "商品 & 效果", contentDescription: "" },
    {
      text: "",
      contentDescription: "蒙奇·D·路飞\nST01-012(签)\n¥31,715.3",
    },
  ]);
});

test("extractUiNodes rejects malformed UIAutomator output", () => {
  assert.throws(
    () => extractUiNodes("permission denied"),
    /valid UIAutomator XML/,
  );
});

test("assertUiContext fails closed when the requested market page is not visible", () => {
  const nodes = [{ text: "个人中心", contentDescription: "" }];

  assert.throws(
    () => assertUiContext(nodes, "航海王总行情"),
    /Expected visible marker/,
  );
});

test("assertScMarketContext requires the exact visible 航海王简中 selection", () => {
  const target = [
    { text: "", contentDescription: "航海王\n简中" },
    { text: "", contentDescription: "航海王总行情" },
  ];
  assert.doesNotThrow(() => assertScMarketContext(target));
  assert.throws(
    () => assertScMarketContext(target.map((node) => ({
      ...node,
      contentDescription: node.contentDescription.replace("简中", "日文"),
    }))),
    /航海王简中|market|language/i,
  );
});

test("card-detail marker does not match a market row containing the same substring", () => {
  const nodes = [{
    text: "",
    contentDescription: "蒙奇·D·路飞\n上周期集换价\n¥9,816.8\n当前价格",
  }];

  assert.throws(() => assertUiContext(nodes, "集换价"), /Expected visible marker/);
});

test("assertTournamentText rejects loading and error pages", () => {
  assert.throws(() => assertTournamentText("加载中…"), /tournament page markers/);
  assert.throws(() => assertTournamentText("赛事名称\n详情\n卡组\n赛果\n瑞士轮"), /markers/);
  assert.doesNotThrow(
    () => assertTournamentText("赛事名称\n航海王简中\n详情\n卡组\n赛果\n瑞士轮"),
  );
});

test("selectTarget rejects an ambiguous WebView selector", () => {
  const targets = [
    { title: "tournamentPack/pages/detail/detail", webSocketDebuggerUrl: "ws://detail" },
    { title: "pages/tournaments/index", webSocketDebuggerUrl: "ws://index" },
  ];

  assert.throws(() => selectTarget(targets, "tournament"), /matched 2 WebViews/);
  assert.equal(selectTarget(targets, "detail/detail").title, targets[0].title);
});

test("summarizeTarget removes query values while keeping routing evidence", () => {
  const summary = summarizeTarget({
    title: "event detail",
    url: "https://example.test/detail?id=public-event&token=secret",
  });

  assert.deepEqual(summary, {
    title: "event detail",
    origin: "https://example.test",
    path: "/detail",
    queryKeys: ["id", "token"],
  });
  assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("summarizeTarget tolerates WebView targets without a URL", () => {
  assert.deepEqual(summarizeTarget({ title: "", url: null }), {
    title: "",
    origin: null,
    path: null,
    queryKeys: [],
  });
});

test("localWebSocketUrl refuses non-loopback DevTools endpoints", () => {
  assert.equal(
    localWebSocketUrl("ws://127.0.0.1:9222/devtools/page/1"),
    "ws://127.0.0.1:9222/devtools/page/1",
  );
  assert.throws(
    () => localWebSocketUrl("wss://example.test/devtools/page/1"),
    /local ws endpoint/,
  );
  assert.throws(
    () => localWebSocketUrl("ws://127.0.0.1:9333/devtools/page/1", 9222),
    /forwarded port/,
  );
});

test("withWebViewForward removes the forward when capture fails", async () => {
  const events = [];
  await assert.rejects(
    withWebViewForward(
      () => events.push("open"),
      () => events.push("close"),
      async () => {
        events.push("capture");
        throw new Error("capture failed");
      },
    ),
    /capture failed/,
  );
  assert.deepEqual(events, ["open", "capture", "close"]);
});

test("termination cleanup runs registered resources in reverse order before re-raising signal", () => {
  const events = [];
  const cleanups = createCleanupStack();
  cleanups.add(() => events.push("lock"));
  const removeSkipped = cleanups.add(() => events.push("skipped"));
  cleanups.add(() => events.push("forward"));
  removeSkipped();

  const fakeProcess = new EventEmitter();
  fakeProcess.pid = 4242;
  fakeProcess.kill = (pid, signal) => events.push(`kill:${pid}:${signal}`);
  const uninstall = installTerminationHandlers(fakeProcess, cleanups);
  fakeProcess.emit("SIGTERM");

  assert.deepEqual(events, ["forward", "lock", "kill:4242:SIGTERM"]);
  assert.equal(fakeProcess.listenerCount("SIGINT"), 0);
  assert.equal(fakeProcess.listenerCount("SIGTERM"), 0);
  uninstall();
});

test("webViewForwardArgs refuses to replace an existing local forwarding rule", () => {
  assert.deepEqual(webViewForwardArgs(9222, "webview_devtools_remote_123"), [
    "forward",
    "--no-rebind",
    "tcp:9222",
    "localabstract:webview_devtools_remote_123",
  ]);
  assert.throws(() => webViewForwardArgs(80, "webview_devtools_remote_123"), /port/i);
  assert.throws(() => webViewForwardArgs(9222, "../../socket"), /socket/i);
});

test("market command removes the UIAutomator file it created", () => {
  const directory = mkdtempSync(join(tmpdir(), "jihuanshe-reader-test-"));
  const adb = join(directory, "adb");
  const log = join(directory, "adb.log");
  writeFileSync(adb, `#!/bin/sh
printf '%s\\n' "$*" >> "$JHS_FAKE_LOG"
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nemulator-5554\\tdevice\\n'
elif [ "$1" = "shell" ] && [ "$2" = "uiautomator" ]; then
  exit 0
elif [ "$1" = "exec-out" ] && [ "$2" = "cat" ]; then
  printf '%s' '<?xml version="1.0"?><hierarchy><node text="" content-desc="航海王&#10;简中" /><node text="航海王总行情" content-desc="" /></hierarchy>'
elif [ "$1" = "shell" ] && [ "$2" = "rm" ]; then
  exit 0
else
  exit 2
fi
`, { mode: 0o700 });
  chmodSync(adb, 0o700);

  try {
    const result = spawnSync(
      process.execPath,
      ["tools/jihuanshe_reader.mjs", "market", "--adb", adb],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, JHS_FAKE_LOG: log },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(log, "utf8"), /shell rm -f \/sdcard\/jihuanshe-window-\d+\.xml/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("decodeRuntimeEvaluation returns a by-value payload and surfaces CDP errors", () => {
  assert.equal(
    decodeRuntimeEvaluation({
      id: 1,
      result: { result: { type: "string", value: "赛事结果" } },
    }),
    "赛事结果",
  );
  assert.throws(
    () => decodeRuntimeEvaluation({ id: 1, error: { message: "denied" } }),
    /CDP evaluation failed: denied/,
  );
});

test("decodeChartEvaluation preserves date metadata and the three price series", () => {
  const encoded = JSON.stringify([
    {
      categories: ["2026.08.19", "2026.08.20"],
      series: [
        { name: "流通品相", points: [{ x: 0, y: 31715.3, category: "2026.08.19" }] },
        { name: "PSA10", points: [{ x: 0, y: 20275, category: "2026.08.19" }] },
        { name: "CCIC金10", points: [{ x: 0, y: 3008.9, category: "2026.08.19" }] },
      ],
    },
  ]);

  assert.deepEqual(decodeChartEvaluation(encoded), [
    {
      categories: ["2026.08.19", "2026.08.20"],
      series: [
        { name: "流通品相", points: [{ x: 0, y: 31715.3, category: "2026.08.19" }] },
        { name: "PSA10", points: [{ x: 0, y: 20275, category: "2026.08.19" }] },
        { name: "CCIC金10", points: [{ x: 0, y: 3008.9, category: "2026.08.19" }] },
      ],
    },
  ]);
  assert.throws(() => decodeChartEvaluation("{}"), /chart array/);
  assert.throws(
    () => decodeChartEvaluation(JSON.stringify([{
      categories: [],
      series: [{ name: "流通品相", points: [] }],
    }])),
    /price point/,
  );
});

test("chart evaluation exposes rendered date ticks without reading unrelated page state", () => {
  const encoded = runInNewContext(CHART_EXPRESSION, {
    globalThis: {
      accountToken: "must-not-appear",
      Highcharts: {
        charts: [{
          xAxis: [{
            categories: [],
            options: {},
            userOptions: {},
            min: 0,
            max: 30,
            tickPositions: [0, 10, 20],
            ticks: {
              0: { label: { textStr: "2026.07.30" } },
              10: { label: { textStr: "2026.08.09" } },
              20: { label: { textStr: "2026.08.19" } },
            },
          }],
          series: [{
            name: "流通品相",
            points: [{ x: 0, y: 31715.3, category: 0 }],
          }],
        }],
      },
    },
  });

  const charts = JSON.parse(encoded);
  assert.deepEqual(charts[0].axis, {
    min: 0,
    max: 30,
    ticks: [
      { x: 0, label: "2026.07.30" },
      { x: 10, label: "2026.08.09" },
      { x: 20, label: "2026.08.19" },
    ],
  });
  assert.equal(encoded.includes("must-not-appear"), false);
});
