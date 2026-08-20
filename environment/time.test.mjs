import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  eventQualifies,
  freshnessAgeDays,
  localDayEnd,
} from "./time.mjs";

const window = {
  startLocalDate: "2026-08-19",
  asOf: "2026-08-20",
  timeZone: "Asia/Shanghai",
};

function dayEvent(localDate, overrides = {}) {
  return {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: `day-${localDate}`,
      time: { precision: "day", localDate, timeZone: "Asia/Shanghai" },
      ...overrides,
    },
  };
}

test("localDayEnd uses the manifest timezone and returns an exact inclusive UTC boundary", () => {
  assert.equal(localDayEnd("2026-08-20", "Asia/Shanghai"), "2026-08-20T15:59:59.999Z");
  assert.equal(localDayEnd("2026-03-08", "America/New_York"), "2026-03-09T03:59:59.999Z");
  assert.equal(localDayEnd("2026-11-01", "America/New_York"), "2026-11-02T04:59:59.999Z");
});

test("localDayEnd rejects invalid calendar dates and IANA zones", () => {
  assert.throws(() => localDayEnd("2026-02-30", "Asia/Shanghai"), (error) => error.code === "time_invalid");
  assert.throws(() => localDayEnd("2026-08-20", "Not/AZone"), (error) => error.code === "time_invalid");
});

test("date-only events remain typed local dates and qualify inclusively", () => {
  assert.equal(eventQualifies(dayEvent("2026-08-19"), window), true);
  assert.equal(eventQualifies(dayEvent("2026-08-20"), window), true);
  assert.equal(eventQualifies(dayEvent("2026-08-18"), window), false);
  assert.equal(eventQualifies(dayEvent("2026-08-21"), window), false);
  assert.equal(eventQualifies(dayEvent("2026-08-20", { status: "in_progress" }), window), false);

  const fixture = readFileSync(
    join(process.cwd(), "tests/fixtures/environment/tournament-event-full-field-a.json"),
    "utf8",
  );
  assert.doesNotMatch(fixture, /T00:00:00Z/);
  assert.doesNotMatch(fixture, /eventStartedAt\"\s*:\s*\"\d{4}-\d{2}-\d{2}T/);
});

test("timestamp events retain their offset while using real UTC overlap boundaries", () => {
  const event = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "timestamped",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-19T23:00:00+08:00",
        eventEndedAt: "2026-08-20T01:00:00+08:00",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  assert.equal(eventQualifies(event, window), true);
  assert.equal(event.data.time.eventStartedAt, "2026-08-19T23:00:00+08:00");
  assert.equal(eventQualifies({
    ...event,
    data: {
      ...event.data,
      time: { ...event.data.time, eventEndedAt: "2026-08-21T00:00:00+08:00" },
    },
  }, window), false);
  assert.equal(eventQualifies({
    ...event,
    data: {
      ...event.data,
      time: { ...event.data.time, eventStartedAt: "2026-08-18T22:00:00+08:00", eventEndedAt: "2026-08-18T23:30:00+08:00" },
    },
  }, window), false);
});

test("timestamp events without an end use their start as their end", () => {
  const event = {
    status: "completed",
    data: {
      eventKey: "timestamp-no-end",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-20T12:00:00+08:00",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  assert.equal(eventQualifies(event, window), true);
});

test("timezones must be explicit and consistent with the selected window", () => {
  assert.throws(
    () => eventQualifies(dayEvent("2026-08-20"), { ...window, timeZone: undefined }),
    (error) => error.code === "time_invalid",
  );
  assert.throws(
    () => eventQualifies({ ...dayEvent("2026-08-20"), data: { ...dayEvent("2026-08-20").data, time: { precision: "day", localDate: "2026-08-20", timeZone: "UTC" } } }, window),
    (error) => error.code === "environment_identity_mismatch",
  );
});

test("freshnessAgeDays uses an injected instant and preserves fractional age", () => {
  assert.equal(
    freshnessAgeDays("2026-08-20T03:59:59.999Z", "2026-08-20T15:59:59.999Z"),
    0.5,
  );
  assert.equal(
    freshnessAgeDays({ precision: "day", localDate: "2026-08-20", timeZone: "Asia/Shanghai" }, "2026-08-21T15:59:59.999Z"),
    1,
  );
});

test("freshnessAgeDays rejects invalid and future evidence", () => {
  assert.throws(
    () => freshnessAgeDays("2026-02-30T00:00:00Z", "2026-08-20T00:00:00Z"),
    (error) => error.code === "freshness_invalid",
  );
  assert.throws(
    () => freshnessAgeDays("2026-08-21T00:00:00Z", "2026-08-20T00:00:00Z"),
    (error) => error.code === "freshness_invalid",
  );
  assert.throws(
    () => freshnessAgeDays({ precision: "day", localDate: "2026-08-20", timeZone: "Not/AZone" }, "2026-08-21T00:00:00Z"),
    (error) => error.code === "freshness_invalid",
  );
});
