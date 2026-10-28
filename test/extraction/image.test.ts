import { describe, expect, it } from "vitest";
import {
  detectImageType,
  downloadImage,
  MAX_IMAGE_BYTES,
  toBase64,
  validateAttachment,
} from "../../src/extraction/image.ts";
import { UserFacingError } from "../../src/lib/errors.ts";
import { IMAGE_BYTES, image, makeAttachment, mockFetch } from "../helpers.ts";

describe("validateAttachment", () => {
  it.each([
    ["poster.png", "image/png"],
    ["poster.jpg", "image/jpeg"],
    ["poster.JPEG", "image/jpeg"],
    ["poster.webp", "image/webp"],
  ])("accepts %s", (filename, content_type) => {
    expect(validateAttachment(makeAttachment({ filename, content_type })).filename).toBe(filename);
  });

  it("falls back to the file extension when Discord omits the content type", () => {
    expect(() => validateAttachment(makeAttachment({ content_type: undefined, filename: "a.webp" }))).not.toThrow();
    expect(() => validateAttachment(makeAttachment({ content_type: undefined, filename: "a.pdf" }))).toThrow(UserFacingError);
  });

  it.each([
    ["missing attachment", undefined, /attach an image/],
    ["GIF", makeAttachment({ filename: "a.gif", content_type: "image/gif" }), /PNG, JPG, or WebP/],
    ["PDF", makeAttachment({ filename: "a.pdf", content_type: "application/pdf" }), /PNG, JPG, or WebP/],
    ["oversized", makeAttachment({ size: MAX_IMAGE_BYTES + 1 }), /too large/],
    ["empty", makeAttachment({ size: 0 }), /empty/],
    ["non-Discord host", makeAttachment({ url: "https://evil.example/poster.png" }), /couldn't read/],
    ["plain http", makeAttachment({ url: "http://cdn.discordapp.com/a.png" }), /couldn't read/],
  ])("rejects %s", (_name, attachment, message) => {
    expect(() => validateAttachment(attachment)).toThrow(message);
  });
});

describe("detectImageType", () => {
  it("identifies formats by signature, not by name", () => {
    expect(detectImageType(IMAGE_BYTES.png)).toBe("image/png");
    expect(detectImageType(IMAGE_BYTES.jpeg)).toBe("image/jpeg");
    expect(detectImageType(IMAGE_BYTES.webp)).toBe("image/webp");
    expect(detectImageType(IMAGE_BYTES.gif)).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("downloadImage", () => {
  it("downloads and detects the real format", async () => {
    mockFetch(() => image(IMAGE_BYTES.webp, "image/png"));
    const result = await downloadImage(makeAttachment());
    expect(result.mimeType).toBe("image/webp");
    expect(result.bytes).toEqual(IMAGE_BYTES.webp);
  });

  it("rejects files whose bytes aren't a supported image", async () => {
    mockFetch(() => image(new TextEncoder().encode("not an image")));
    await expect(downloadImage(makeAttachment())).rejects.toThrow(/isn't a valid image/);
  });

  it("enforces the size cap while streaming", async () => {
    mockFetch(() => image(new Uint8Array(MAX_IMAGE_BYTES + 10)));
    await expect(downloadImage(makeAttachment())).rejects.toThrow(/too large/);
  });

  it("reports download failures", async () => {
    mockFetch(() => new Response("gone", { status: 404 }));
    await expect(downloadImage(makeAttachment())).rejects.toThrow(/couldn't download/);
  });
});

describe("toBase64", () => {
  it("encodes bytes", () => {
    expect(toBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });
});
