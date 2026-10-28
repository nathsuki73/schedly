import { describe, expect, it } from "vitest";
import { UserFacingError } from "../../src/lib/errors.ts";
import { isPublicHostname, parsePublicUrl } from "../../src/lib/url-safety.ts";

describe("parsePublicUrl", () => {
  it("accepts public http(s) links", () => {
    expect(parsePublicUrl(" https://lu.ma/abc123 ").hostname).toBe("lu.ma");
    expect(parsePublicUrl("http://www.eventbrite.com/e/123").protocol).toBe("http:");
  });

  it.each([
    "not a url",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 in decimal
    "http://0x7f.0.0.1/",
    "http://10.1.2.3/",
    "http://172.20.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://intranet/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "",
  ])("rejects %s", (input) => {
    expect(() => parsePublicUrl(input)).toThrow(UserFacingError);
  });
});

describe("isPublicHostname", () => {
  it("allows public IPs and domains", () => {
    expect(isPublicHostname("8.8.8.8")).toBe(true);
    expect(isPublicHostname("example.com")).toBe(true);
    expect(isPublicHostname("172.32.0.1")).toBe(true);
  });
});
