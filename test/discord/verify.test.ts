import { describe, expect, it } from "vitest";
import { hexToBytes, verifyDiscordRequest } from "../../src/discord/verify.ts";
import { createSigner } from "../helpers.ts";

describe("verifyDiscordRequest", () => {
  it("accepts a valid signature", async () => {
    const signer = await createSigner();
    const sig = await signer.sign("1700000000", '{"type":1}');
    expect(await verifyDiscordRequest('{"type":1}', sig, "1700000000", signer.publicKeyHex)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const signer = await createSigner();
    const sig = await signer.sign("1700000000", '{"type":1}');
    expect(await verifyDiscordRequest('{"type":2}', sig, "1700000000", signer.publicKeyHex)).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const [a, b] = await Promise.all([createSigner(), createSigner()]);
    const sig = await a.sign("1700000000", "{}");
    expect(await verifyDiscordRequest("{}", sig, "1700000000", b.publicKeyHex)).toBe(false);
  });

  it("rejects missing or malformed headers", async () => {
    const signer = await createSigner();
    expect(await verifyDiscordRequest("{}", null, "1", signer.publicKeyHex)).toBe(false);
    expect(await verifyDiscordRequest("{}", "zz", "1", signer.publicKeyHex)).toBe(false);
    expect(await verifyDiscordRequest("{}", "ab".repeat(64), null, signer.publicKeyHex)).toBe(false);
    expect(await verifyDiscordRequest("{}", "ab".repeat(64), "1", "")).toBe(false);
  });
});

describe("hexToBytes", () => {
  it("decodes valid hex and rejects invalid input", () => {
    expect([...hexToBytes("00ff10")!]).toEqual([0, 255, 16]);
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
  });
});
