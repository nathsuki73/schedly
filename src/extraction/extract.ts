import type { Env } from "../env.ts";
import { fetchPage } from "./fetch-page.ts";
import { buildSystemPrompt, callGemini } from "./gemini.ts";
import { extractPageContent, type PageContent } from "./html.ts";
import { normalizeExtraction, type ExtractedEvent } from "./validate.ts";

const MAX_JSON_LD_CHARS = 6000;

export interface ExtractOptions {
  fallbackTimeZone?: string | undefined;
  now?: number;
}

/** Full pipeline: fetch page → reduce HTML → ask Gemini → validate. */
export async function extractEvent(env: Env, url: URL, opts: ExtractOptions = {}): Promise<ExtractedEvent> {
  const now = opts.now ?? Date.now();
  const page = await fetchPage(url);
  const content = await extractPageContent(page.html);
  const raw = await callGemini(env, buildSystemPrompt(new Date(now).toISOString().slice(0, 10)), buildUserContent(page.finalUrl, content));
  return normalizeExtraction(raw, { sourceUrl: url.toString(), fallbackTimeZone: opts.fallbackTimeZone, now });
}

export function buildUserContent(url: string, content: PageContent): string {
  const meta = Object.entries(content.meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const jsonLd = content.jsonLdEvents.length
    ? JSON.stringify(content.jsonLdEvents).slice(0, MAX_JSON_LD_CHARS)
    : "(none)";
  return [
    `URL: ${url}`,
    `Page title: ${content.title || "(none)"}`,
    `Meta tags:\n${meta || "(none)"}`,
    `Structured data (JSON-LD events):\n${jsonLd}`,
    `Page text:\n${content.text || "(none)"}`,
  ].join("\n\n");
}
