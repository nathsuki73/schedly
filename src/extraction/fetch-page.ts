import { UserFacingError } from "../lib/errors.ts";
import { parsePublicUrl } from "../lib/url-safety.ts";

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
/** Larger pages are truncated; event details are almost always near the top. Keeps CPU time low. */
export const MAX_PAGE_BYTES = 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; SchedlyBot/1.0; +https://github.com/schedly)";

export interface FetchedPage {
  finalUrl: string;
  html: string;
}

/**
 * Fetches an event page with SSRF protections: every redirect hop is re-validated,
 * responses must be HTML, and bodies are capped in size and time.
 */
export async function fetchPage(url: URL): Promise<FetchedPage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) throw new UserFacingError("That link redirected somewhere I couldn't follow.");
        current = parsePublicUrl(new URL(location, current).toString());
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        throw new UserFacingError(
          res.status === 401 || res.status === 403
            ? "That page requires a login or blocks bots, so I can't read it. Try a public event page."
            : res.status === 404
              ? "That page doesn't exist (404). Please double-check the link."
              : `That page returned an error (HTTP ${res.status}). Please try again later or use a different link.`,
        );
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await res.body?.cancel();
        throw new UserFacingError("That link isn't a web page (e.g. it's a file or image). Please share the event's page.");
      }

      return { finalUrl: current.toString(), html: await readCapped(res, MAX_PAGE_BYTES) };
    }
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new UserFacingError("That page took too long to load. Please try again later.");
    }
    throw new UserFacingError("I couldn't reach that page. Please check the link and try again.");
  }
  throw new UserFacingError("That link redirected too many times.");
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    total += chunk.byteLength;
    html += decoder.decode(chunk, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return html + decoder.decode();
}
