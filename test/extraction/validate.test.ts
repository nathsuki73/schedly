import { describe, expect, it } from "vitest";
import type { RawExtraction } from "../../src/extraction/gemini.ts";
import { normalizeExtraction } from "../../src/extraction/validate.ts";
import { UserFacingError } from "../../src/lib/errors.ts";

const NOW = Date.parse("2030-01-01T00:00:00Z");
const SOURCE = "https://example.com/event";

function raw(overrides: Partial<RawExtraction> = {}): RawExtraction {
  return {
    is_event: true,
    title: "Intro to Rust Workshop",
    description: "A hands-on beginner workshop.",
    start_local: "2030-03-05T18:00",
    end_local: "2030-03-05T19:30",
    utc_offset: "+08:00",
    timezone: null,
    location: "Zoom",
    is_online: true,
    ...overrides,
  };
}

const normalize = (r: RawExtraction, fallbackTimeZone?: string) =>
  normalizeExtraction(r, { sourceUrl: SOURCE, fallbackTimeZone, now: NOW });

describe("normalizeExtraction", () => {
  it("converts a complete extraction to UTC with no warnings", () => {
    expect(normalize(raw())).toEqual({
      title: "Intro to Rust Workshop",
      description: "A hands-on beginner workshop.",
      startTime: "2030-03-05T10:00:00.000Z",
      endTime: "2030-03-05T11:30:00.000Z",
      location: "Zoom",
      warnings: [],
    });
  });

  it("uses an IANA timezone when no explicit offset is given", () => {
    const event = normalize(raw({ utc_offset: null, timezone: "America/New_York" }));
    expect(event.startTime).toBe("2030-03-05T23:00:00.000Z");
    expect(event.warnings).toEqual([]);
  });

  it("falls back to the user's timezone, then UTC, with a warning", () => {
    const withFallback = normalize(raw({ utc_offset: null, timezone: "Not/AZone" }), "Asia/Manila");
    expect(withFallback.startTime).toBe("2030-03-05T10:00:00.000Z");
    expect(withFallback.warnings[0]).toMatch(/assumed Asia\/Manila/);

    const utc = normalize(raw({ utc_offset: null, timezone: null }));
    expect(utc.startTime).toBe("2030-03-05T18:00:00.000Z");
    expect(utc.warnings[0]).toMatch(/assumed UTC/);
  });

  it("assumes a one-hour duration when the end is missing or invalid", () => {
    const noEnd = normalize(raw({ end_local: null }));
    expect(noEnd.endTime).toBe("2030-03-05T11:00:00.000Z");
    expect(noEnd.warnings).toContain("No end time found; assumed 1 hour.");

    const backwards = normalize(raw({ end_local: "2030-03-05T17:00" }));
    expect(backwards.endTime).toBe("2030-03-05T11:00:00.000Z");
    expect(backwards.warnings[0]).toMatch(/end time looked invalid/);
  });

  it("uses the source link as location when none is found", () => {
    const inPerson = normalize(raw({ location: null, is_online: false }));
    expect(inPerson.location).toBe(SOURCE);
    expect(inPerson.warnings).toContain("No location found; using the event link.");

    expect(normalize(raw({ location: "  ", is_online: true })).warnings).toEqual([]);
  });

  it("enforces Discord length limits and strips control characters", () => {
    const event = normalize(raw({ title: `A\u0007${"x".repeat(200)}`, location: "y".repeat(200) }));
    expect(event.title.length).toBe(100);
    expect(event.title.startsWith("Ax")).toBe(true);
    expect(event.location.length).toBe(100);
  });

  it.each<[string, Partial<RawExtraction>, RegExp]>([
    ["not an event", { is_event: false }, /doesn't look like a single event/],
    ["missing title", { title: null }, /name/],
    ["missing start", { start_local: null }, /start date and time/],
    ["date without time", { start_local: "2030-03-05" }, /start date and time/],
    ["past event", { start_local: "2029-12-31T10:00", end_local: null }, /already started or ended/],
  ])("rejects %s with a helpful message", (_name, overrides, message) => {
    expect(() => normalize(raw(overrides))).toThrow(UserFacingError);
    expect(() => normalize(raw(overrides))).toThrow(message);
  });
});
