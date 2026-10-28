// Turns the model's raw answer into a trustworthy, Discord-ready event — or a clear
// explanation of why it can't be scheduled. Never trust model output without this step.
import { UserFacingError } from "../lib/errors.ts";
import { isValidTimeZone, localToUtcMs, parseLocalDateTime, parseUtcOffset, type Zone } from "../lib/time.ts";
import type { RawExtraction } from "./gemini.ts";

export interface ExtractedEvent {
  title: string;
  description: string | null;
  /** ISO 8601, UTC. */
  startTime: string;
  /** ISO 8601, UTC. */
  endTime: string;
  location: string;
  warnings: string[];
}

export interface NormalizeOptions {
  sourceUrl: string;
  /** Timezone supplied by the user to use when the page doesn't state one. */
  fallbackTimeZone?: string | undefined;
  now?: number;
}

// Discord limits: name 1-100, location 1-100, description up to 1000 (we reserve room for the source link).
export const MAX_TITLE = 100;
export const MAX_LOCATION = 100;
export const MAX_DESCRIPTION = 800;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1000;

export function normalizeExtraction(raw: RawExtraction, opts: NormalizeOptions): ExtractedEvent {
  const now = opts.now ?? Date.now();
  const warnings: string[] = [];

  if (!raw || raw.is_event === false) {
    throw new UserFacingError(
      "That page doesn't look like a single event. Please share the event's own page (not a home page or list).",
    );
  }

  const title = clean(raw.title, MAX_TITLE);
  if (!title) throw new UserFacingError("I couldn't find the event's name on that page.");

  const start = raw.start_local ? parseLocalDateTime(raw.start_local) : null;
  if (!start) {
    throw new UserFacingError("I couldn't find a start date and time on that page, so I can't schedule it.");
  }

  const zone = resolveZone(raw, opts.fallbackTimeZone, warnings);
  const startMs = localToUtcMs(start, zone);
  if (startMs <= now) {
    throw new UserFacingError("That event has already started or ended, so it can't be scheduled.");
  }

  const end = raw.end_local ? parseLocalDateTime(raw.end_local) : null;
  let endMs = end ? localToUtcMs(end, zone) : NaN;
  if (!end) {
    endMs = startMs + DEFAULT_DURATION_MS;
    warnings.push("No end time found; assumed 1 hour.");
  } else if (!(endMs > startMs) || endMs - startMs > MAX_DURATION_MS) {
    endMs = startMs + DEFAULT_DURATION_MS;
    warnings.push("The end time looked invalid; assumed 1 hour.");
  }

  let location = clean(raw.location, MAX_LOCATION);
  if (!location) {
    location = truncate(opts.sourceUrl, MAX_LOCATION);
    if (raw.is_online !== true) warnings.push("No location found; using the event link.");
  }

  return {
    title,
    description: clean(raw.description, MAX_DESCRIPTION) || null,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    location,
    warnings,
  };
}

function resolveZone(raw: RawExtraction, fallback: string | undefined, warnings: string[]): Zone {
  const offset = raw.utc_offset ? parseUtcOffset(raw.utc_offset) : null;
  if (offset !== null) return { offsetMinutes: offset };
  if (raw.timezone && isValidTimeZone(raw.timezone)) return { timeZone: raw.timezone };
  if (fallback && isValidTimeZone(fallback)) {
    warnings.push(`The page didn't state a timezone; assumed ${fallback}.`);
    return { timeZone: fallback };
  }
  warnings.push("The page didn't state a timezone; assumed UTC. Re-run with the `timezone` option to change it.");
  return { offsetMinutes: 0 };
}

function clean(value: string | null | undefined, max: number): string {
  if (typeof value !== "string") return "";
  // Strip control characters and collapse whitespace (keep newlines in descriptions readable).
  const text = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim();
  return truncate(text, max);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
