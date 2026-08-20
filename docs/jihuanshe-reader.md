# JiHuanShe SC data reader

## Status

Verified 2026-08-20 against JiHuanShe Android 3.42.5 in an owner-authenticated
Android 15 ARM64 emulator. Starting from a completely offline AVD, the capture
command starts the same logged-in AVD with no window, launches the app, selects
One Piece Simplified Chinese, and exports the rendered data. No manual emulator
window or page setup is required.

The app exposes the required Simplified Chinese data through three rendered surfaces:

| Data | Surface | Reader |
|---|---|---|
| Tournament results and standings | tournament WebView | visible `document.body.innerText` |
| Tournament deck distribution and submitted decks | tournament WebView | visible `document.body.innerText` |
| Current market index and per-card prices | Flutter accessibility tree | UIAutomator `text` and `content-desc` |
| Card prices and chart series | Flutter accessibility tree + AAChartKit WebView | UIAutomator + rendered Highcharts series |

[`tools/jihuanshe_capture.mjs`](../tools/jihuanshe_capture.mjs) owns the headless
emulator lifecycle and semantic navigation. The lower-level
[`tools/jihuanshe_reader.mjs`](../tools/jihuanshe_reader.mjs) reads a page that is
already open. Both read only data rendered to the logged-in user. They do not
inspect cookies, local/session storage, request headers, application files, SMS
data, or authentication tokens.

## Usage

Run one command from the repository root. The tool attaches to `emulator-5554`
when it is already online; otherwise it starts `JiHuanShe_SC` with `-no-window`
and waits for Android to finish booting. It cold-launches JiHuanShe to a known
home state while preserving the AVD's login. Node.js 22 or newer is required.

```bash
# Start/attach, navigate to 集换行情 → 航海王 → 简中, and emit market data.
node tools/jihuanshe_capture.mjs collect market

# Start/attach, navigate to 赛事大厅 → 航海王简中 → newest completed event,
# then emit detail, complete 赛果 standings, and 卡组 distribution/list data.
node tools/jihuanshe_capture.mjs collect tournaments

# Lifecycle commands. A successful capture leaves the headless emulator running.
node tools/jihuanshe_capture.mjs status
node tools/jihuanshe_capture.mjs start
node tools/jihuanshe_capture.mjs stop
```

The AVD launch uses `-no-window`, `-no-audio`, `-no-boot-anim`, `-no-metrics`,
and `-no-snapshot`; it never uses `-wipe-data`, `-read-only`, or
`-no-snapshot-save`. `collect` is serialized by a process lock so two invocations
cannot start or drive the same AVD concurrently. If the saved app session has
expired, the command returns JSON status `reauth_required` with exit code 2;
open the emulator once to log in again, then return to headless operation.

The owned AVD and console endpoint are fixed to `JiHuanShe_SC` and
`emulator-5554`; the tool verifies both before attaching or stopping and refuses
other values. The local DevTools port defaults to `9222`. Override executable
discovery with `--adb PATH` or `--emulator PATH`; `--boot-timeout` and
`--home-timeout` are seconds. Captures are written only to stdout; redirect them
when deliberate retention is required.

The lower-level reader remains useful for a page opened manually. Its market and
tournament commands enforce visible `航海王简中` context; card/chart commands are
page diagnostics and do not independently prove the selected game or language:

```bash
node tools/jihuanshe_reader.mjs market       # visible market page
node tools/jihuanshe_reader.mjs card         # visible individual card page
node tools/jihuanshe_reader.mjs tournament   # visible tournament detail page

# On an individual card page, emit the rendered price-chart series.
node tools/jihuanshe_reader.mjs chart

# Diagnose which JiHuanShe WebViews are currently visible. URL query values are removed.
node tools/jihuanshe_reader.mjs targets
```

Every successful capture writes one JSON object with `schemaVersion`, `source`,
`status`, `surface`, `capturedAt`, emulator provenance, and `data`. Navigation is
fail-closed: it requires exact game/language markers, derives tap points from the
current UI/DOM, verifies the selected event identity after navigation, requires
the requested active tab, and waits for real standings rows instead of accepting
an empty table header. The temporary DevTools mapping uses ADB `--no-rebind`, so
it cannot replace a pre-existing local forwarding rule. Device-side UI XML and
the local ADB forward are removed on success, error, `SIGINT`, and `SIGTERM` paths;
the process lock is also released, and a newly spawned emulator is terminated if
boot fails. An uncatchable termination such as
`SIGKILL` can still leave the process lock, temporary XML, or forward for manual
cleanup; stale locks are reclaimed on the next invocation.

Captured stdout can contain public participant handles, submitted deck data, and
current prices visible on the selected page. Store and share captures accordingly;
the tool itself does not write them into the repository.

Run both test files with:

```bash
node --test tools/jihuanshe_capture.test.mjs
node --test tools/jihuanshe_reader.test.mjs
```

## Evidence and limits

- Live tournament pages exposed an app-owned Chrome DevTools socket and yielded
  the same event metadata, bracket, Swiss rows, records, scores, deck-share rows,
  and submitted-deck rows shown on screen.
- A full offline-to-capture test launched `qemu-system-aarch64-headless` with
  `-avd JiHuanShe_SC`, `-port 5554`, `-no-window`, and `-no-snapshot`; it retained
  the authenticated session, captured the market, and
  then captured tournament results/decks from the same no-window process.
- Live market and card-detail UIAutomator captures contained the same game,
  language, index, current/previous price, change, condition, rarity, and update
  date shown on screen. AAChartKit exposed three rendered series: raw-card,
  PSA10, and CCIC Gold 10 prices.
- JADX confirms the Android wrapper and manifest, but the useful application code
  is Flutter AOT in `libapp.so`. Static analysis found ranking and market services
  under `/api/market`, including ranking and price-history routes.
- Those services install authorization/signing and crypto interceptors. Direct
  unauthenticated API calls cannot replace the authenticated app session, and
  this reader does not try to bypass or reproduce that boundary.
- The manifest exposes only generic launch/deeplink entry points; market,
  tournament, and card-detail pages are internal Flutter/mini-program routes.
  Semantic navigation is therefore the verified automation path.
- WebView discovery is verified for the emulator build, where the debugging socket
  belongs to the app's main process. A future multi-process app build may require
  selecting a different JiHuanShe PID.
- The output is a source capture, not canonical project data. Preserve event date,
  participant count, capture time, and raw labels during normalization. Do not
  infer field share from top-cut frequency, and keep SC empirical data separate
  from EN proxies and simulated results.
