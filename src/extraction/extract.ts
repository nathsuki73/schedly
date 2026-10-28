import type { Env } from "../env.ts";
import { UserFacingError } from "../lib/errors.ts";
import { toDraft, type EventDraft } from "./draft.ts";
import { buildSystemPrompt, callGemini } from "./gemini.ts";
import { toBase64, type DownloadedImage } from "./image.ts";

export interface ExtractOptions {
  /** Zone from the /schedule `timezone` option, already normalized. */
  fallbackTimeZone?: string | null;
  now?: number;
}

/** Sends the image to Gemini and returns one draft per event found (at least one). */
export async function extractDrafts(env: Env, image: DownloadedImage, opts: ExtractOptions = {}): Promise<EventDraft[]> {
  const today = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10);
  const raw = await callGemini(
    env,
    buildSystemPrompt(today),
    { base64: toBase64(image.bytes), mimeType: image.mimeType },
    "Extract every event shown in this image.",
  );

  const drafts = raw.events.map((e) => toDraft(e, opts.fallbackTimeZone ?? null)).filter(hasSubstance);
  if (!raw.contains_event || drafts.length === 0) {
    const reason = raw.reason ? ` (${raw.reason.slice(0, 120)})` : "";
    throw new UserFacingError(
      `I couldn't find any event details in that image${reason}. Please upload a poster, announcement, or screenshot that shows the event's name and date.`,
    );
  }
  return drafts;
}

/** Drops "events" with neither a title nor a date. They aren't identifiable. */
function hasSubstance(d: EventDraft): boolean {
  return Boolean(d.title || d.startDate);
}
