import { EnvironmentError } from "./errors.mjs";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MILLIS_PER_DAY = 86_400_000;

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validLocalDate(value) {
  const match = typeof value === "string" ? LOCAL_DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function assertLocalDate(value, path) {
  if (!validLocalDate(value)) fail("time_invalid", `${path} must be a valid local date`, { path, value });
  return value;
}

function assertTimeZone(timeZone, path = "timeZone") {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    fail("time_invalid", `${path} must be an IANA timezone`, { path, timeZone });
  }
  try {
    // Construction is the portable way to validate an IANA zone in Node's ICU.
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23" }).format(0);
  } catch (error) {
    fail("time_invalid", `${path} is not a valid IANA timezone`, {
      path,
      timeZone,
      cause: error?.message,
    });
  }
  return timeZone;
}

function isValidTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
  ) return false;
  const offset = match[8];
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function assertTimestamp(value, path) {
  if (!isValidTimestamp(value)) {
    fail("time_invalid", `${path} must be a valid RFC 3339 timestamp`, { path, value });
  }
  return value;
}

function parseDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const result = {};
  for (const part of parts) {
    if (part.type !== "literal") result[part.type] = Number(part.value);
  }
  return result;
}

function utcMillisForLocalParts({ year, month, day, hour, minute, second, millisecond = 0 }) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, millisecond);
  return value.getTime();
}

function zoneOffsetAt(epochMs, timeZone) {
  const parts = parseDateParts(new Date(epochMs), timeZone);
  const milliseconds = ((epochMs % 1000) + 1000) % 1000;
  const localAsUtc = utcMillisForLocalParts(parts) + milliseconds;
  return localAsUtc - epochMs;
}

function localBoundaryMillis(localDate, timeZone, hour, minute, second, millisecond) {
  const [year, month, day] = localDate.split("-").map(Number);
  const targetAsUtc = utcMillisForLocalParts({ year, month, day, hour, minute, second, millisecond });
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const next = targetAsUtc - zoneOffsetAt(candidate, timeZone);
    if (next === candidate) break;
    candidate = next;
  }
  const actual = parseDateParts(new Date(candidate), timeZone);
  if (
    actual.year !== year
    || actual.month !== month
    || actual.day !== day
    || actual.hour !== hour
    || actual.minute !== minute
    || actual.second !== second
  ) {
    fail("time_invalid", "local wall-clock boundary does not exist in timezone", {
      localDate,
      timeZone,
      hour,
      minute,
      second,
    });
  }
  return candidate;
}

function parseInstant(value, path, { allowDate = false } = {}) {
  if (allowDate && value instanceof Date) {
    const epoch = value.getTime();
    if (Number.isFinite(epoch)) return epoch;
    fail("freshness_invalid", `${path} must be a valid instant`, { path, value });
  }
  assertTimestamp(value, path);
  return Date.parse(value);
}

function extractEventTime(event) {
  const data = isRecord(event?.data) ? event.data : event;
  if (!isRecord(data)) return null;
  if (isRecord(data.time)) return data.time;
  if (isRecord(event?.time)) return event.time;
  if (isRecord(data.eventStartedAt) && data.eventStartedAt.precision === "day") {
    return data.eventStartedAt;
  }
  if (data.eventStartedAt !== undefined) {
    return {
      precision: "timestamp",
      eventStartedAt: data.eventStartedAt,
      ...(data.eventEndedAt === undefined ? {} : { eventEndedAt: data.eventEndedAt }),
      timeZone: data.timeZone ?? event?.environment?.timeZone,
    };
  }
  return null;
}

function assertWindow(window) {
  if (!isRecord(window)) fail("time_invalid", "window must be an object", { window });
  assertLocalDate(window.startLocalDate, "window.startLocalDate");
  assertLocalDate(window.asOf, "window.asOf");
  assertTimeZone(window.timeZone, "window.timeZone");
  if (window.startLocalDate > window.asOf) {
    fail("time_invalid", "window start is after asOf", { window });
  }
  return window;
}

function assertEventTime(value) {
  if (!isRecord(value) || typeof value.precision !== "string") {
    fail("time_invalid", "event time must be an explicit precision-bearing union", { value });
  }
  assertTimeZone(value.timeZone, "event.time.timeZone");
  if (value.precision === "day") {
    if (Object.keys(value).some((key) => !["precision", "localDate", "timeZone"].includes(key))) {
      fail("time_invalid", "day precision contains timestamp fields", { value });
    }
    assertLocalDate(value.localDate, "event.time.localDate");
    return value;
  }
  if (value.precision === "timestamp") {
    assertTimestamp(value.eventStartedAt, "event.time.eventStartedAt");
    if (value.eventEndedAt !== undefined) assertTimestamp(value.eventEndedAt, "event.time.eventEndedAt");
    if (value.eventEndedAt !== undefined && Date.parse(value.eventEndedAt) < Date.parse(value.eventStartedAt)) {
      fail("time_invalid", "event end precedes event start", { value });
    }
    return value;
  }
  fail("time_invalid", "event time precision is unsupported", { precision: value.precision });
}

export function localDayEnd(asOf, timeZone) {
  assertLocalDate(asOf, "asOf");
  assertTimeZone(timeZone);
  const epoch = localBoundaryMillis(asOf, timeZone, 23, 59, 59, 999);
  return new Date(epoch).toISOString();
}

function localDayStart(asOf, timeZone) {
  return localBoundaryMillis(asOf, timeZone, 0, 0, 0, 0);
}

export function eventQualifies(event, window) {
  assertWindow(window);
  const eventTime = assertEventTime(extractEventTime(event));
  const eventStatus = event?.data?.status ?? event?.status;
  if (eventStatus !== "completed") return false;
  const eventEnvironmentZone = event?.environment?.timeZone;
  if (eventEnvironmentZone !== undefined && eventEnvironmentZone !== eventTime.timeZone) {
    fail("environment_identity_mismatch", "event environment timezone differs from event time", {
      eventEnvironmentZone,
      eventTimeZone: eventTime.timeZone,
    });
  }
  if (eventTime.timeZone !== window.timeZone) {
    fail("environment_identity_mismatch", "event timezone differs from selected window", {
      eventTimeZone: eventTime.timeZone,
      windowTimeZone: window.timeZone,
    });
  }
  if (eventTime.precision === "day") {
    return eventTime.localDate >= window.startLocalDate && eventTime.localDate <= window.asOf;
  }
  const startedAt = Date.parse(eventTime.eventStartedAt);
  const endedAt = eventTime.eventEndedAt === undefined
    ? startedAt
    : Date.parse(eventTime.eventEndedAt);
  const windowStart = localDayStart(window.startLocalDate, window.timeZone);
  const windowEnd = Date.parse(localDayEnd(window.asOf, window.timeZone));
  return endedAt >= windowStart && startedAt <= windowEnd && endedAt <= windowEnd;
}

function freshnessEvidenceMillis(value) {
  if (typeof value === "string") return parseInstant(value, "value");
  if (value instanceof Date) return parseInstant(value, "value", { allowDate: true });
  if (!isRecord(value)) fail("freshness_invalid", "freshness value must be a timestamp or precision-bearing time", { value });
  if (value.precision === "day") {
    try {
      return Date.parse(localDayEnd(value.localDate, value.timeZone));
    } catch (error) {
      if (error instanceof EnvironmentError) {
        fail("freshness_invalid", error.message, { cause: error.code });
      }
      throw error;
    }
  }
  if (value.precision === "timestamp") {
    const end = value.eventEndedAt ?? value.eventStartedAt;
    return parseInstant(end, "value.eventEndedAt");
  }
  fail("freshness_invalid", "freshness value precision is unsupported", { value });
}

export function freshnessAgeDays(value, now) {
  let evidenceMs;
  try {
    evidenceMs = freshnessEvidenceMillis(value);
  } catch (error) {
    if (error instanceof EnvironmentError && error.code === "freshness_invalid") throw error;
    fail("freshness_invalid", error?.message ?? "freshness value is invalid", { cause: error?.code });
  }
  let nowMs;
  try {
    nowMs = parseInstant(now, "now", { allowDate: true });
  } catch (error) {
    if (error instanceof EnvironmentError) {
      fail("freshness_invalid", error.message, { cause: error.code });
    }
    throw error;
  }
  const ageMs = nowMs - evidenceMs;
  if (ageMs < 0) {
    fail("freshness_invalid", "evidence is in the future relative to injected now", {
      value,
      now,
    });
  }
  return ageMs / MILLIS_PER_DAY;
}

export { assertEventTime, assertTimeZone, extractEventTime };
