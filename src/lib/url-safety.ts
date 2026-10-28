import { UserFacingError } from "./errors.ts";

const MAX_URL_LENGTH = 2048;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".onion"];

/**
 * Parses user input as a public http(s) URL, rejecting anything that could reach
 * internal infrastructure (SSRF): loopback, private/link-local ranges, IP-literal IPv6,
 * credentials in the URL, and non-standard ports.
 */
export function parsePublicUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) throw new UserFacingError("Please provide a valid event link.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserFacingError("That doesn't look like a valid link. It should start with `https://`.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserFacingError("Only `http://` and `https://` links are supported.");
  }
  if (url.username || url.password) {
    throw new UserFacingError("Links containing credentials aren't supported.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UserFacingError("Links with custom ports aren't supported.");
  }
  if (!isPublicHostname(url.hostname)) {
    throw new UserFacingError("That link points to a private or local address, which isn't supported.");
  }
  return url;
}

export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost") return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // IPv6 literals ([::1], [fd00::], ...) are never needed for event pages.
  if (host.startsWith("[")) return false;

  const ipv4 = parseIpv4(host);
  if (ipv4) return !isPrivateIpv4(ipv4);

  // Bare hostnames without a dot (e.g. "intranet") aren't public.
  return host.includes(".");
}

function parseIpv4(host: string): number[] | null {
  // The URL parser already normalizes decimal/hex/octal forms to dotted quads.
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}
