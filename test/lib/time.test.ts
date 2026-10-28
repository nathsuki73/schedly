import { describe, expect, it } from "vitest";
import {
  formatZone,
  isValidTimeZone,
  localToUtcMs,
  parseLocalDateTime,
  parseTimeZoneInput,
  parseUtcOffset,
} from "../../src/lib/time.ts";

const iso = (ms: number) => new Date(ms).toISOString();

describe("parseLocalDateTime", () => {
  it("parses wall-clock times and ignores trailing offsets", () => {
    expect(parseLocalDateTime("2030-03-05T14:30")).toEqual({ year: 2030, month: 3, day: 5, hour: 14, minute: 30, second: 0 });
    expect(parseLocalDateTime("2030-03-05T14:30:15-05:00")?.second).toBe(15);
  });

  it("rejects malformed or impossible dates", () => {
    expect(parseLocalDateTime("2030-02-31T10:00")).toBeNull();
    expect(parseLocalDateTime("2030-03-05T25:00")).toBeNull();
    expect(parseLocalDateTime("March 5")).toBeNull();
    expect(parseLocalDateTime("2030-03-05")).toBeNull();
  });
});

describe("parseUtcOffset", () => {
  it("handles common offset formats", () => {
    expect(parseUtcOffset("Z")).toBe(0);
    expect(parseUtcOffset("+08:00")).toBe(480);
    expect(parseUtcOffset("-0530")).toBe(-330);
    expect(parseUtcOffset("-05")).toBe(-300);
    expect(parseUtcOffset("PST")).toBeNull();
    expect(parseUtcOffset("+15:00")).toBeNull();
  });
});

describe("localToUtcMs", () => {
  const local = parseLocalDateTime("2030-07-01T09:00")!;

  it("applies explicit offsets", () => {
    expect(iso(localToUtcMs(local, { offsetMinutes: 480 }))).toBe("2030-07-01T01:00:00.000Z");
  });

  it("applies IANA zones including DST", () => {
    expect(iso(localToUtcMs(local, { timeZone: "Asia/Manila" }))).toBe("2030-07-01T01:00:00.000Z");
    // New York is UTC-4 in summer, UTC-5 in winter.
    expect(iso(localToUtcMs(local, { timeZone: "America/New_York" }))).toBe("2030-07-01T13:00:00.000Z");
    const winter = parseLocalDateTime("2030-01-15T09:00")!;
    expect(iso(localToUtcMs(winter, { timeZone: "America/New_York" }))).toBe("2030-01-15T14:00:00.000Z");
  });
});

describe("isValidTimeZone", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("parseTimeZoneInput", () => {
  it.each([
    ["Asia/Manila", "Asia/Manila"],
    ["asia/manila", "Asia/Manila"],
    ["PHT", "Asia/Manila"],
    ["Philippine Standard Time", "Asia/Manila"],
    ["manila", "Asia/Manila"],
    ["UTC+8", "+08:00"],
    ["GMT+08:00", "+08:00"],
    ["+0530", "+05:30"],
    ["UTC-5", "-05:00"],
    ["UTC", "UTC"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(parseTimeZoneInput(input)).toBe(expected);
  });

  it.each(["PST", "cst", "IST", "Mars/Base", "UTC+20", "", null])("rejects ambiguous or unknown %s", (input) => {
    expect(parseTimeZoneInput(input)).toBeNull();
  });

  it("formats zones for display", () => {
    expect(formatZone("+08:00")).toBe("UTC+08:00");
    expect(formatZone("Asia/Manila")).toBe("Asia/Manila");
  });
});
