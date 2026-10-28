import { describe, expect, it } from "vitest";
import { decodeEntities, extractPageContent, findEvents, MAX_TEXT_CHARS } from "../../src/extraction/html.ts";
import eventPage from "../fixtures/event-page.html?raw";

describe("extractPageContent", () => {
  it("extracts title, meta tags, JSON-LD events, and visible text", async () => {
    const content = await extractPageContent(eventPage);

    expect(content.title).toBe("Intro to Rust Workshop & Q&A | Example Events");
    expect(content.meta).toMatchObject({
      "og:title": "Intro to Rust Workshop",
      description: "Learn Rust basics in 90 minutes.",
    });
    expect(content.meta).not.toHaveProperty("viewport");

    expect(content.jsonLdEvents).toHaveLength(1);
    expect(content.jsonLdEvents[0]).toMatchObject({ "@type": "EducationEvent", startDate: "2030-03-05T18:00:00+08:00" });

    expect(content.text).toContain("Join us on March 5, 2030 at 6:00 PM PHT on Zoom.");
    expect(content.text).not.toContain("tracking");
    expect(content.text).not.toContain("color: red");
    expect(content.text).not.toContain("Enable JavaScript");
    expect(content.text).not.toContain("icon text");
  });

  it("still reads body text when </head> is omitted", async () => {
    const content = await extractPageContent("<html><head><title>T</title><body><p>Body text</p>");
    expect(content.text).toContain("Body text");
  });

  it("caps the amount of text sent to the model", async () => {
    const content = await extractPageContent(`<p>${"word ".repeat(10_000)}</p>`);
    expect(content.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });
});

describe("findEvents", () => {
  it("finds Event types at the top level, in arrays, and ignores invalid JSON", () => {
    expect(findEvents('{"@type":"Event","name":"A"}')).toHaveLength(1);
    expect(findEvents('[{"@type":["Thing","BusinessEvent"]},{"@type":"Person"}]')).toHaveLength(1);
    expect(findEvents("{not json")).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Q&amp;A &#8211; &#x1F4C5; &lt;b&gt; &unknown;")).toBe("Q&A – 📅 <b> &unknown;");
  });
});
