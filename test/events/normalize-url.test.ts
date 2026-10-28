import { describe, expect, it } from "vitest";
import { hashUrl, normalizeUrl } from "../../src/events/normalize-url.ts";

const norm = (s: string) => normalizeUrl(new URL(s));

describe("normalizeUrl", () => {
  it("treats tracking variants of the same link as identical", () => {
    const canonical = norm("https://lu.ma/event/abc?id=7");
    expect(norm("http://www.LU.ma/event/abc/?utm_source=x&id=7&fbclid=123#details")).toBe(canonical);
  });

  it("keeps meaningful query parameters and sorts them", () => {
    expect(norm("https://example.com/e?b=2&a=1")).toBe("https://example.com/e?a=1&b=2");
    expect(norm("https://example.com/e?id=1")).not.toBe(norm("https://example.com/e?id=2"));
  });
});

describe("hashUrl", () => {
  it("returns a stable SHA-256 hex digest", async () => {
    const hash = await hashUrl("https://example.com/");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashUrl("https://example.com/")).toBe(hash);
  });
});
