import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { extractEvent } from "../../src/extraction/extract.ts";
import { fetchPage, MAX_PAGE_BYTES } from "../../src/extraction/fetch-page.ts";
import eventPage from "../fixtures/event-page.html?raw";
import { geminiResponse, html, jsonResponse, mockFetch } from "../helpers.ts";

const GEMINI = "generativelanguage.googleapis.com";
const NOW = Date.parse("2030-01-01T00:00:00Z");

const gemini = (extraction: Record<string, unknown>) => (req: Request) =>
  req.url.includes(GEMINI) ? geminiResponse(extraction) : undefined;

const rustWorkshop = {
  is_event: true,
  title: "Intro to Rust Workshop",
  description: "A hands-on beginner workshop.",
  start_local: "2030-03-05T18:00",
  end_local: "2030-03-05T19:30",
  utc_offset: "+08:00",
  timezone: "Asia/Manila",
  location: "Zoom",
  is_online: true,
};

describe("extractEvent", () => {
  it("fetches the page, sends a structured request to Gemini, and validates the answer", async () => {
    const calls = mockFetch((req) => (req.url.startsWith("https://example.com/") ? html(eventPage) : undefined), gemini(rustWorkshop));

    const event = await extractEvent(env, new URL("https://example.com/rust"), { now: NOW });
    expect(event.startTime).toBe("2030-03-05T10:00:00.000Z");
    expect(event.title).toBe("Intro to Rust Workshop");

    const geminiCall = calls.find((c) => c.url.includes(GEMINI))!;
    expect(geminiCall.url).toContain(`/models/${env.GEMINI_MODEL}:generateContent`);
    expect(geminiCall.headers.get("x-goog-api-key")).toBe(env.GEMINI_API_KEY);
    expect(geminiCall.url).not.toContain(env.GEMINI_API_KEY); // key never in the URL
    const body = geminiCall.body as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0]!.text).toMatch(/untrusted data/);
    expect(body.systemInstruction.parts[0]!.text).toContain("2030-01-01");
    expect(body.contents[0]!.parts[0]!.text).toContain("2030-03-05T18:00:00+08:00");
  });

  it("surfaces Gemini rate limits as a friendly message", async () => {
    mockFetch(
      (req) => (req.url.startsWith("https://example.com/") ? html(eventPage) : undefined),
      (req) => (req.url.includes(GEMINI) ? jsonResponse({ error: {} }, 429) : undefined),
    );
    await expect(extractEvent(env, new URL("https://example.com/rust"), { now: NOW })).rejects.toThrow(/rate limit/);
  });
});

describe("fetchPage", () => {
  it("follows safe redirects but blocks redirects to private addresses", async () => {
    mockFetch((req) => {
      if (req.url === "https://short.example/a") return new Response(null, { status: 302, headers: { location: "https://example.com/final" } });
      if (req.url === "https://example.com/final") return html("<p>ok</p>");
      if (req.url === "https://short.example/evil") return new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } });
      return undefined;
    });

    expect((await fetchPage(new URL("https://short.example/a"))).finalUrl).toBe("https://example.com/final");
    await expect(fetchPage(new URL("https://short.example/evil"))).rejects.toThrow(/private or local address/);
  });

  it("rejects non-HTML responses and error statuses", async () => {
    mockFetch(
      (req) => (req.url.endsWith(".pdf") ? new Response("%PDF", { headers: { "content-type": "application/pdf" } }) : undefined),
      (req) => (req.url.endsWith("/missing") ? html("nope", 404) : undefined),
      (req) => (req.url.endsWith("/private") ? html("login", 403) : undefined),
    );
    await expect(fetchPage(new URL("https://example.com/file.pdf"))).rejects.toThrow(/isn't a web page/);
    await expect(fetchPage(new URL("https://example.com/missing"))).rejects.toThrow(/404/);
    await expect(fetchPage(new URL("https://example.com/private"))).rejects.toThrow(/login or blocks bots/);
  });

  it("truncates oversized pages", async () => {
    mockFetch(() => html("a".repeat(MAX_PAGE_BYTES + 5000)));
    expect((await fetchPage(new URL("https://example.com/big"))).html.length).toBe(MAX_PAGE_BYTES);
  });

  it("reports network failures without leaking details", async () => {
    mockFetch(() => {
      throw new TypeError("internal network error detail");
    });
    await expect(fetchPage(new URL("https://example.com/"))).rejects.toThrow("I couldn't reach that page");
  });
});
