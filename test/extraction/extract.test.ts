import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { extractDrafts } from "../../src/extraction/extract.ts";
import { parseExtraction } from "../../src/extraction/gemini.ts";
import { geminiResponse, IMAGE_BYTES, jsonResponse, makeRawEvent, mockFetch } from "../helpers.ts";

const NOW = Date.parse("2030-01-01T00:00:00Z");
const png = { bytes: IMAGE_BYTES.png, mimeType: "image/png" as const };

describe("extractDrafts", () => {
  it("sends the image inline with a structured-output request", async () => {
    const calls = mockFetch(() => geminiResponse({ contains_event: true, reason: null, events: [makeRawEvent()] }));

    const drafts = await extractDrafts(env, png, { now: NOW });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.title).toBe("Intro to Rust Workshop");

    const call = calls[0]!;
    expect(call.url).toContain(`/models/${env.GEMINI_MODEL}:generateContent`);
    expect(call.headers.get("x-goog-api-key")).toBe(env.GEMINI_API_KEY);
    expect(call.url).not.toContain(env.GEMINI_API_KEY);
    const body = call.body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: [{ inlineData: { mimeType: string; data: string } }, { text: string }] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(body.contents[0]!.parts[0].inlineData).toEqual({ mimeType: "image/png", data: btoa(String.fromCharCode(...IMAGE_BYTES.png)) });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0]!.text).toMatch(/untrusted data/);
    expect(body.systemInstruction.parts[0]!.text).toMatch(/Never invent information/);
    expect(body.systemInstruction.parts[0]!.text).toContain("2030-01-01");
  });

  it("returns every distinct event from a multi-event poster", async () => {
    mockFetch(() =>
      geminiResponse({
        contains_event: true,
        reason: null,
        events: [
          makeRawEvent({ title: "Day 1: Basics", start_date: "2099-03-05" }),
          makeRawEvent({ title: "Day 2: Async", start_date: "2099-03-12" }),
          makeRawEvent({ title: null, start_date: null }), // unidentifiable: dropped
        ],
      }),
    );
    const drafts = await extractDrafts(env, png, { now: NOW });
    expect(drafts.map((d) => d.title)).toEqual(["Day 1: Basics", "Day 2: Async"]);
  });

  it("rejects images without identifiable event information", async () => {
    mockFetch(() => geminiResponse({ contains_event: false, reason: "a photo of a cat", events: [] }));
    await expect(extractDrafts(env, png, { now: NOW })).rejects.toThrow(
      /couldn't find any event details in that image \(a photo of a cat\)/,
    );
  });

  it("surfaces Gemini rate limits and errors as friendly messages", async () => {
    mockFetch(() => jsonResponse({ error: {} }, 429));
    await expect(extractDrafts(env, png, { now: NOW })).rejects.toThrow(/rate limit/);
    mockFetch(() => jsonResponse({ error: { message: "secret detail" } }, 500));
    await expect(extractDrafts(env, png, { now: NOW })).rejects.toThrow("The AI service returned an error. Please try again later.");
  });
});

describe("parseExtraction", () => {
  it("tolerates malformed or wrongly-typed fields", () => {
    const parsed = parseExtraction(
      JSON.stringify({
        contains_event: "yes",
        events: [{ title: 42, start_date: "2099-01-01", ambiguities: ["ok", 7], is_online: "true" }, "junk"],
      }),
    );
    expect(parsed.contains_event).toBe(false);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ title: null, start_date: "2099-01-01", ambiguities: ["ok"], is_online: null });
  });

  it("rejects non-JSON answers", () => {
    expect(() => parseExtraction("Sure! Here's the event:")).toThrow(/unreadable answer/);
  });

  it("caps the number of events", () => {
    const events = Array.from({ length: 30 }, () => ({ title: "x" }));
    expect(parseExtraction(JSON.stringify({ contains_event: true, events })).events).toHaveLength(10);
  });
});
