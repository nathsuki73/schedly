/**
 * Verifies Discord's Ed25519 request signature using Web Crypto (no dependencies).
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint-validating-security-request-headers
 */
export async function verifyDiscordRequest(
  body: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): Promise<boolean> {
  if (!signature || !timestamp || !publicKeyHex) return false;
  const publicKey = hexToBytes(publicKeyHex);
  const sig = hexToBytes(signature);
  if (!publicKey || publicKey.length !== 32 || !sig || sig.length !== 64) return false;

  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
