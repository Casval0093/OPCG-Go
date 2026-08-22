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

// C2: a timestamp's declared RFC 3339 offset must agree with what its declared IANA zone
// actually yields at that instant. Asia/Shanghai has no DST, so its real offset is always
// +08:00; any other declared offset for that zone is malformed upstream data and must fail
// closed rather than being used to compute a (silently wrong) UTC instant.
test("C2: a timestamp's offset must match its declared IANA zone at that instant", () => {
  const wrongOffset = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "c2-wrong-offset",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-19T23:00:00+05:00",
        eventEndedAt: "2026-08-20T01:00:00+05:00",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  assert.throws(() => eventQualifies(wrongOffset, window), (error) => error.code === "time_invalid");

  // Same bug, but the wrong offset happens to land the computed UTC instant back inside the
  // window: this must still fail closed rather than silently returning true.
  const wrongOffsetOutOfWindow = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "c2-wrong-offset-out-of-window",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-21T00:30:00+16:00",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  assert.throws(() => eventQualifies(wrongOffsetOutOfWindow, window), (error) => error.code === "time_invalid");

  // The same wall clock, correctly offset, is genuinely out of window (not a throw, just false).
  const correctOffsetOutOfWindow = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "c2-correct-offset-out-of-window",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-21T00:30:00+08:00",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  assert.equal(eventQualifies(correctOffsetOutOfWindow, window), false);
});

// I2: timestamp precision must whitelist its union keys exactly the way day precision already
// does. Before the fix, a "timestamp" object could carry a stray "localDate" or any other junk
// key and still be accepted.
test("I2: timestamp precision rejects foreign union keys the same way day precision does", () => {
  const dayShapedTimestamp = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "i2-timestamp-with-localdate",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-20T12:00:00+08:00",
        timeZone: "Asia/Shanghai",
        localDate: "2026-08-20",
      },
    },
  };
  assert.throws(() => eventQualifies(dayShapedTimestamp, window), (error) => error.code === "time_invalid");

  const junkKeyTimestamp = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "i2-timestamp-with-junk-key",
      time: {
        precision: "timestamp",
        eventStartedAt: "2026-08-20T12:00:00+08:00",
        timeZone: "Asia/Shanghai",
        bogusField: "nonsense",
      },
    },
  };
  assert.throws(() => eventQualifies(junkKeyTimestamp, window), (error) => error.code === "time_invalid");
});

// I9: extractEventTime must not synthesize a time union from loose eventStartedAt/eventEndedAt
// fields, and must never borrow event.environment.timeZone when the source declared none. The
// event carries the explicit Task 5 union at its declared location (data.time) or fails closed.
test("I9: loose eventStartedAt/eventEndedAt fields are never synthesized into a time union", () => {
  const looseEvent = {
    status: "completed",
    environment: { timeZone: "Asia/Shanghai" },
    data: {
      eventKey: "i9-loose-fields",
      eventStartedAt: "2026-08-20T12:00:00+08:00",
      eventEndedAt: "2026-08-20T14:00:00+08:00",
    },
  };
  assert.throws(() => eventQualifies(looseEvent, window), (error) => error.code === "time_invalid");
});
