import { describe, expect, it } from "vitest";
import { applyEdits, resolveDraft, toDraft } from "../../src/extraction/draft.ts";
import { makeDraft, makeRawEvent } from "../helpers.ts";

const NOW = Date.parse("2030-01-01T00:00:00Z");

describe("toDraft", () => {
  it("keeps clear values and normalizes the registration URL", () => {
    const draft = toDraft(makeRawEvent(), null);
    expect(draft).toMatchObject({
      title: "Intro to Rust Workshop",
      startDate: "2099-03-05",
      startTime: "18:00",
      timeZone: "Asia/Manila",
      registrationUrl: "https://example.com/register",
    });
    expect(draft.notes).toEqual([]);
  });

  it("prefers an explicit UTC offset over a named zone", () => {
    expect(toDraft(makeRawEvent({ utc_offset: "+09:00", timezone: "Asia/Manila" }), null).timeZone).toBe("+09:00");
  });

  it("never resolves ambiguous abbreviations like PST, even if the model guessed", () => {
    const draft = toDraft(
      makeRawEvent({ timezone: "America/Los_Angeles", timezone_text: "PST", timezone_ambiguous: false }),
      null,
    );
    expect(draft.timeZone).toBeNull();
    expect(draft.notes.join(" ")).toMatch(/“PST”, which could mean more than one timezone/);
  });

  it("uses the command's timezone for ambiguous or missing zones, and says so", () => {
    const ambiguous = toDraft(makeRawEvent({ timezone: null, timezone_text: "PST", timezone_ambiguous: true }), "Asia/Manila");
    expect(ambiguous.timeZone).toBe("Asia/Manila");
    expect(ambiguous.notes.join(" ")).toMatch(/ambiguous; using Asia\/Manila from your timezone option/);

    const missing = toDraft(makeRawEvent({ timezone: null, timezone_text: null }), "+08:00");
    expect(missing.timeZone).toBe("+08:00");
    expect(missing.notes.join(" ")).toMatch(/No timezone on the image; using UTC\+08:00/);
  });

  it("maps Philippine time text to Asia/Manila when the model left timezone empty", () => {
    expect(toDraft(makeRawEvent({ timezone: null, timezone_text: "Philippine Standard Time" }), null).timeZone).toBe(
      "Asia/Manila",
    );
  });

  it("drops malformed dates, times, and URLs instead of guessing", () => {
    const draft = toDraft(
      makeRawEvent({ start_date: "next Saturday", start_time: "25:00", registration_url: "javascript:alert(1)" }),
      null,
    );
    expect(draft.startDate).toBeNull();
    expect(draft.startTime).toBeNull();
    expect(draft.registrationUrl).toBeNull();
    expect(draft.notes.join(" ")).toMatch(/Couldn't understand the start date/);
  });

  it("enforces Discord length limits and strips control characters", () => {
    const draft = toDraft(makeRawEvent({ title: `A\u0007${"x".repeat(200)}`, location: "y".repeat(200) }), null);
    expect(draft.title).toHaveLength(100);
    expect(draft.title!.startsWith("Ax")).toBe(true);
    expect(draft.location).toHaveLength(100);
  });
});

describe("resolveDraft", () => {
  it("converts a complete draft to UTC", () => {
    const { event, missing } = resolveDraft(makeDraft(), NOW);
    expect(missing).toEqual([]);
    expect(event).toMatchObject({
      startTime: "2099-03-05T10:00:00.000Z",
      endTime: "2099-03-05T11:30:00.000Z",
      location: "Zoom",
    });
  });

  it("lists every missing essential instead of guessing", () => {
    const { event, missing } = resolveDraft(
      makeDraft({ title: null, startTime: null, timeZone: null, location: null, isOnline: false }),
      NOW,
    );
    expect(event).toBeNull();
    expect(missing).toEqual(["Event title", "Start time", "Timezone", "Location (venue or online platform)"]);
  });

  it("flags events that have already started", () => {
    expect(resolveDraft(makeDraft({ startDate: "2029-12-31" }), NOW).missing[0]).toMatch(/has passed/);
  });

  it("assumes 1 hour without an end time, and handles overnight events", () => {
    const noEnd = resolveDraft(makeDraft({ endTime: null }), NOW);
    expect(noEnd.event?.endTime).toBe("2099-03-05T11:00:00.000Z");
    expect(noEnd.assumptions).toContain("No end time shown; assumed 1 hour.");

    const overnight = resolveDraft(makeDraft({ startTime: "22:00", endTime: "01:00" }), NOW);
    expect(overnight.event?.endTime).toBe("2099-03-05T17:00:00.000Z");
    expect(overnight.assumptions[0]).toMatch(/ends the next day/);
  });

  it("uses the registration link (or 'Online') as location for online events without a platform", () => {
    expect(resolveDraft(makeDraft({ location: null }), NOW).event?.location).toBe("https://example.com/register");
    expect(resolveDraft(makeDraft({ location: null, registrationUrl: null }), NOW).event?.location).toBe("Online");
  });

  it("supports fixed offsets", () => {
    expect(resolveDraft(makeDraft({ timeZone: "-05:00" }), NOW).event?.startTime).toBe("2099-03-05T23:00:00.000Z");
  });
});

describe("applyEdits", () => {
  const edits = { title: "Rust Night", start: "2099-04-01 19:00", end: "21:00", timeZone: "UTC+8", location: "BGC, Taguig" };

  it("applies valid edits and clears AI notes", () => {
    const result = applyEdits(makeDraft({ notes: ["Year not shown"] }), edits);
    expect(result).toMatchObject({
      draft: {
        title: "Rust Night",
        startDate: "2099-04-01",
        startTime: "19:00",
        endDate: null,
        endTime: "21:00",
        timeZone: "+08:00",
        location: "BGC, Taguig",
        notes: [],
      },
    });
  });

  it("reports every invalid field", () => {
    const result = applyEdits(makeDraft(), { title: " ", start: "April 1", end: "late", timeZone: "PST", location: "" });
    expect("errors" in result && result.errors).toEqual([
      "Title can't be empty.",
      "Start must look like `2026-11-08 14:00`.",
      "End must look like `2026-11-08 16:00` or `16:00`, or be left blank.",
      "“PST” is ambiguous. Use a name like `Asia/Manila` or an offset like `UTC+8`.",
      "Location can't be empty (use the venue or e.g. `Zoom`).",
    ]);
  });
});
