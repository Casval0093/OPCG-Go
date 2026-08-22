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

Tournament enumeration scrolls the index until the visible item set stops
growing. `--max-scrolls N` (default 40) bounds that loop and is a hard
fail-closed ceiling, not a best-effort hint: exhausting it raises
`enumeration_did_not_stabilize` rather than returning a partial list.
`--item-ceiling N` (default 500) bounds how many items one enumeration may
report. Selection is likewise fail-closed after any navigation: a selected event
that is no longer visible raises `event_key_not_found`, one that cannot be
scrolled into the viewport raises `event_unreachable`, a detail page whose
provider id disagrees with the index raises `event_identity_mismatch`, and a
detail page offering no two-sided provider-id agreement raises
`event_identity_unverifiable`. Two visible events collapsing onto one selection
key raise `event_identity_ambiguous`.

Every capture invocation prints exactly one JSON object on stdout, on success
**and** on failure. A failure is a `schemaVersion: 2` envelope
`{schemaVersion, source, status: "error", stage, code, details, surface?}` with
no `lifecycle` block; the human-readable line on stderr is diagnostic only and is
never part of that envelope. Exit is `0` for success, `2` for `reauth_required`,
and `1` otherwise. Codes raised as plain errors (the navigation and enumeration
codes above) arrive as `code: "error"` with `details.message` beginning
`<code>: `; the lifecycle codes (`lifecycle_timeout`, `lease_recovery_refused`,
`avd_lock_held`, `foreign_avd`, and the rest) arrive in `code` directly.

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

## Refresh, publication, and reauthentication

[`tools/jihuanshe_refresh.mjs`](../tools/jihuanshe_refresh.mjs) is the layer above
the capture tool: it drives the capture CLI as a child process, hands the exact
captured bytes to the normalizer, and publishes immutable source snapshots under
`data/sources/sc/jihuanshe/{tournaments,market}/<snapshotId>.json`. It never
writes under `data/environment-aliases/` — advancing an environment alias belongs
to Manifest publication, which is a separate command.

**Routine refresh is headless. A visible emulator appears only when the owner
runs `reauth` themselves.** Nothing in the refresh path can open a window: an
expired session ends the refresh with code `reauth_required` and exit `2`, and the
owner then decides whether to reauthenticate.

```bash
# Read-only: AVD state, whether a refresh is in progress, and how many snapshots exist.
node tools/jihuanshe_refresh.mjs status

# Headless refresh. One capture child per surface; each cleans up only what it started.
node tools/jihuanshe_refresh.mjs refresh market
node tools/jihuanshe_refresh.mjs refresh tournaments --as-of 2026-08-20 --window-days 30
node tools/jihuanshe_refresh.mjs refresh all --as-of 2026-08-20 --window-days 30

# Visible, owner-driven, one-time. The SMS code is typed into the emulator, never passed here.
node tools/jihuanshe_refresh.mjs reauth
```

**Pass `--root` unless the intent is to commit the snapshots.** `--root` defaults to *this
checkout*, and `data/sources/` is **not** gitignored, so a bare `refresh` publishes into the working
tree and dirties tracked state. Anything exploratory belongs in a scratch root.

**A non-publishable provider event id is redacted AT BIRTH, so the id, the filename and the body
agree.** When a provider event id is phone-number-shaped, or is not a safe short identifier, the
normalizer replaces it with a fixed `redacted` marker: the snapshot id stem becomes
`jihuanshe-tournament-redacted-<16-hex content hash>`, the artifact on disk is written under
exactly that name, and `source.sourceRef.providerEventId` in the body reads `redacted` too. The
event key falls back to the identity-derived key, so the event still dedupes stably against later
captures of itself. The raw id is never hashed, encoded or stored anywhere, so the redaction is
irreversible by construction rather than by cost — there is no preimage to attack.

**The snapshot BODY is value-screened, not just key-screened.** Free-text provider labels — the
event title, organizer, location, format and status labels, `sanitizedRoute`, and the market
surface's card and query labels — are scanned for phone numbers, e-mail addresses, WeChat/QQ
handles, `Authorization`/`Bearer`/token-like strings, and over-long blobs. A match redacts the
offending SPAN in place, keeps the surrounding text, and adds
`sensitive_value_redacted:<field>:<shape>` (or `free_text_truncated:<field>`) to the snapshot's
`coverage.warnings`. It never drops the field and never fails the capture: an SC store event keeps
its evidentiary value without the organizer's phone number. It is not a personal-NAME detector — a
name has no shape — so free text remains free text and `data/sources/**` remains data you should
read before you commit it.

How these snapshots become field share, Manifests and strength — and the boundaries that stop a
capture from becoming a claim — are in [`docs/environment-data.md`](environment-data.md).

Every invocation prints exactly one sanitized JSON object:
`{schemaVersion, source, operation, status, stage, code, lifecycle, published,
warnings, details?}`. Stages are `lock`, `capture`, `normalize`, `validate`,
`publish_snapshot`, and `cleanup`, plus `complete` on success. Stable codes are
`lock_busy`, `reauth_required`, `ui_contract_changed`,
`unsupported_capture_schema`, `event_identity_ambiguous`, `normalization_failed`,
`snapshot_validation_failed`, `snapshot_publish_failed`, `cleanup_failed`, and
`event_conflict`. Exit is `0` only for success, `2` only for `reauth_required`,
and `1` for everything else. Two further values belong to the **command line**,
never to an operation result: an unusable argument list prints
`stage: "arguments"` with `code: "refresh_input_invalid"` and exit `1`. An
operation that fails before it can produce a result of its own is still reported
with a real stage and stable code (a refresh that cannot establish its lock
reports `lock/lock_busy`; `reauth` and `status` report `cleanup/cleanup_failed`),
with the precise cause in `details.reason`. The result carries no capture bytes, participant
identifiers, credentials, session tokens, pids, filesystem paths, or child
stderr; a child failure code is repeated back only when it is on the tool's
allowlist, and the child's free-text message is dropped. Provider-derived
identifiers are screened on the way out as a second line of defence behind the
normalizer's own at-birth redaction: a phone-number-shaped snapshot id read off
disk from an older build is reported as `jihuanshe-tournament-redacted-<16-hex
content hash>`, keeping the suffix so the file stays locatable, and an event key
that is not the plain `jihuanshe:tournament:<id>` shape is reported as
`jihuanshe:tournament:redacted`. Neither redacted form is derived from the value
it replaces.

`refresh all` runs the two surfaces sequentially and gives **each** child
`--cleanup-started`, so each cleans up exactly what it started and nothing else.
The cost is a second emulator boot: the tournament child stops the AVD it
started, and the market child then boots the same AVD again. That is deliberate —
the alternative leaves an adopted emulator running and reports a cleanup that did
not happen. Use two separate commands if a single boot matters more.

An empty capture window is not a failure: when no completed event falls inside
`--window-days` of `--as-of`, the refresh succeeds with an empty
`published.snapshotIds`, warning `no_events_in_window`, and exit `0`, and in
`refresh all` the market surface still runs.

Publication is idempotent per observation. The same event captured again with
identical evidence reuses the original snapshot ID and warns
`observation_reused`. That reuse check is tournament-only, by design: a
byte-identical **market** capture republishes to the same immutable ID (the store
is idempotent) but reports no reuse warning. **Changed** evidence for an event already on disk publishes
the new immutable snapshot **beside** the old one and then reports
`event_conflict` with exit `1`: neither version is overwritten, deleted, or
promoted, and a later field build must select one version explicitly. A market
failure never rolls back an already published tournament snapshot.

**Two locks, in a fixed order.** The refresh tool takes a
`refresh-publication` lock before spawning the child and holds it across capture,
normalization, validation, and publication. The child alone takes `avd-drive`,
owns every UI action, and performs its own invocation cleanup; the refresh
process never stops an emulator after a normal child return, success or failure.
If a child dies without producing a valid capture result, the refresh process
delegates recovery to the lifecycle module, which proves the recorded lock owner
dead, revalidates the exact process-start token, and cleans only that lease —
refusing outright when identity cannot be verified. A second refresh started
while the first holds the lock returns `lock_busy` and spawns nothing;
`reauth` returns `lock_busy` rather than interrupting a running capture.

**If recovery keeps failing `avd_recovery_lost_race`, delete the orphaned recovery
mutex by hand.** Recovery is guarded by a second file, `<avd-lock-path>.recovery`,
created exclusively and removed in a `finally` on every normal and error return.
Only a hard kill of the recovering process — `SIGKILL`, an OOM kill, a power loss —
can leave it behind, and nothing reclaims it automatically: the file carries no
liveness proof of its own, so an age-based reclaim would be a guess. Every later
recovery then loses the race and reports `avd_recovery_lost_race` ("another caller
is already recovering this lock"), which points at a process that does not exist.
The only exit is:

```bash
rm /tmp/jihuanshe-avd-drive.lock.recovery     # or "${--avd-lock-path}.recovery"
```

Recognise it by `avd_recovery_lost_race` repeating across separate, serial
invocations with no other capture running. A genuine race clears on the next
attempt; an orphaned mutex never does.

`reauth` runs entirely under `avd-drive`. On a verified headless AVD it rechecks
the exact process identity, stops only that process, starts the same
`JiHuanShe_SC` visibly (no `-no-window`), opens the app's own login screen, and
waits for the authenticated home state. If it started the visible emulator it
stops that exact process after a successful login, still holding the lock, so the
next refresh is headless again; a login that never completes leaves the window up
for the owner. An emulator the owner had already opened is attached and left
running. Phone numbers, SMS codes, and session tokens are never accepted as
arguments, stored, read, or replayed.

Raw capture bytes stay in memory unless `--retain-raw DIRECTORY` is given
explicitly. Retention refuses a symlink — including one in a **parent** component of the
requested path, checked against the deepest existing component's real path — and
refuses a directory that is not exactly `0700`, creates the directory `0700` when absent, writes one `0600` file
per capture with `wx`, fsyncs it, and reports only `retention: {retained, ...}` —
never the path. Retained bytes are local diagnostic data, are not tracked
artifacts, and are deleted by hand.

```bash
node --test tools/jihuanshe_refresh.test.mjs
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
