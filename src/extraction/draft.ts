// Event drafts: the validated, possibly incomplete result of reading an image.
// Model output is untrusted, and this module is the only gate between it and Discord.
// Missing details are never guessed. They are reported so the user can fill them in.
import {
  AMBIGUOUS_ZONE_ABBREVIATIONS,
  formatZone,
  localToUtcMs,
  parseLocalDateTime,
  parseTimeZoneInput,
  toZone,
} from "../lib/time.ts";
import type { RawEvent } from "./gemini.ts";

export interface EventDraft {
  title: string | null;
  description: string | null;
  /** "YYYY-MM-DD" wall-clock date in `timeZone`. */
  startDate: string | null;
  /** "HH:mm", 24-hour. */
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  /** IANA name or fixed offset like "+08:00". */
  timeZone: string | null;
  /** Timezone text exactly as printed on the image (shown when it was ambiguous). */
  timeZoneText: string | null;
  location: string | null;
  isOnline: boolean | null;
  registrationUrl: string | null;
  organizer: string | null;
  /** Things the user should double-check (ambiguities, assumptions). */
  notes: string[];
}

/** A complete event, ready for Discord. Times are ISO 8601 UTC. */
export interface ResolvedEvent {
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  location: string;
  isOnline: boolean | null;
  registrationUrl: string | null;
  organizer: string | null;
}

export interface Resolution {
  event: ResolvedEvent | null;
  /** Blocking problems, phrased for the user. Empty when `event` is set. */
  missing: string[];
  /** Non-blocking assumptions made while resolving. */
  assumptions: string[];
}

// Discord limits: name 1-100, location 1-100, description up to 1000 (room reserved for extras).
export const MAX_TITLE = 100;
export const MAX_LOCATION = 100;
export const MAX_DESCRIPTION = 700;
const MAX_ORGANIZER = 100;
const MAX_URL = 500;
const MAX_NOTE = 200;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Builds a draft from one model-extracted event. `fallbackTimeZone` comes from the command option. */
export function toDraft(raw: RawEvent, fallbackTimeZone: string | null): EventDraft {
  const notes = (raw.ambiguities ?? []).map((n) => clean(n, MAX_NOTE)).filter(Boolean);

  const startDate = validDate(raw.start_date);
  const startTime = validTime(raw.start_time);
  if (raw.start_date && !startDate) notes.push(`Couldn't understand the start date “${clean(raw.start_date, 40)}”.`);
  if (raw.start_time && !startTime) notes.push(`Couldn't understand the start time “${clean(raw.start_time, 40)}”.`);

  const timeZoneText = clean(raw.timezone_text, 40) || null;
  const ambiguous =
    raw.timezone_ambiguous === true ||
    (timeZoneText !== null && AMBIGUOUS_ZONE_ABBREVIATIONS.has(timeZoneText.toUpperCase()));

  // An explicit offset always wins; a named zone counts only when it isn't ambiguous.
  let timeZone =
    parseTimeZoneInput(raw.utc_offset) ??
    (ambiguous ? null : (parseTimeZoneInput(raw.timezone) ?? parseTimeZoneInput(timeZoneText)));

  if (!timeZone && fallbackTimeZone) {
    timeZone = fallbackTimeZone;
    notes.push(
      ambiguous
        ? `The image says “${timeZoneText}”, which is ambiguous; using ${formatZone(fallbackTimeZone)} from your timezone option.`
        : `No timezone on the image; using ${formatZone(fallbackTimeZone)} from your timezone option.`,
    );
  } else if (!timeZone && ambiguous) {
    notes.push(
      `The image says “${timeZoneText ?? "?"}”, which could mean more than one timezone (e.g. PST = Pacific or Philippine). Set it with **Edit Details**.`,
    );
  }

  return {
    title: clean(raw.title, MAX_TITLE) || null,
    description: clean(raw.description, MAX_DESCRIPTION) || null,
    startDate,
    startTime,
    endDate: validDate(raw.end_date),
    endTime: validTime(raw.end_time),
    timeZone,
    timeZoneText,
    location: clean(raw.location, MAX_LOCATION) || null,
    isOnline: raw.is_online,
    registrationUrl: validUrl(raw.registration_url),
    organizer: clean(raw.organizer, MAX_ORGANIZER) || null,
    notes,
  };
}

/** Works out whether a draft is complete and converts it to UTC. Never guesses missing essentials. */
export function resolveDraft(draft: EventDraft, now = Date.now()): Resolution {
  const missing: string[] = [];
  const assumptions: string[] = [];

  if (!draft.title) missing.push("Event title");
  if (!draft.startDate) missing.push("Start date");
  if (!draft.startTime) missing.push("Start time");
  if (!draft.timeZone) missing.push("Timezone");

  let location = draft.location;
  if (!location) {
    if (draft.isOnline) {
      location = draft.registrationUrl && draft.registrationUrl.length <= MAX_LOCATION ? draft.registrationUrl : "Online";
      assumptions.push(`No platform shown; location set to “${location}”.`);
    } else {
      missing.push("Location (venue or online platform)");
    }
  }

  if (missing.length || !draft.startDate || !draft.startTime || !draft.timeZone) {
    return { event: null, missing, assumptions };
  }

  const zone = toZone(draft.timeZone);
  const start = parseLocalDateTime(`${draft.startDate}T${draft.startTime}`);
  if (!start) return { event: null, missing: ["A valid start date and time"], assumptions };
  const startMs = localToUtcMs(start, zone);
  if (startMs <= now) return { event: null, missing: ["A start time in the future (this one has passed)"], assumptions };

  let endMs = NaN;
  if (draft.endTime) {
    const end = parseLocalDateTime(`${draft.endDate ?? draft.startDate}T${draft.endTime}`);
    if (end) endMs = localToUtcMs(end, zone);
    if (!draft.endDate && endMs <= startMs) {
      endMs += 24 * 60 * 60 * 1000;
      assumptions.push("The end time is earlier than the start; assumed it ends the next day.");
    }
  }
  if (!draft.endTime) {
    endMs = startMs + DEFAULT_DURATION_MS;
    assumptions.push("No end time shown; assumed 1 hour.");
  } else if (!(endMs > startMs) || endMs - startMs > MAX_DURATION_MS) {
    endMs = startMs + DEFAULT_DURATION_MS;
    assumptions.push("The end time looked invalid; assumed 1 hour.");
  }

  return {
    event: {
      title: draft.title!,
      description: draft.description,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      location: location!,
      isOnline: draft.isOnline,
      registrationUrl: draft.registrationUrl,
      organizer: draft.organizer,
    },
    missing,
    assumptions,
  };
}

/** Values from the Edit Details modal. */
export interface DraftEdits {
  title: string;
  start: string;
  end: string;
  timeZone: string;
  location: string;
}

/** Applies user edits. Returns the updated draft, or the list of problems to fix. */
export function applyEdits(draft: EventDraft, edits: DraftEdits): { draft: EventDraft } | { errors: string[] } {
  const errors: string[] = [];

  const title = clean(edits.title, MAX_TITLE);
  if (!title) errors.push("Title can't be empty.");

  const start = splitDateTime(edits.start);
  if (!start) errors.push("Start must look like `2026-11-08 14:00`.");

  let endDate: string | null = null;
  let endTime: string | null = null;
  if (edits.end.trim()) {
    const end = splitDateTime(edits.end) ?? (validTime(edits.end) ? { date: null, time: validTime(edits.end)! } : null);
    if (!end) errors.push("End must look like `2026-11-08 16:00` or `16:00`, or be left blank.");
    else {
      endDate = end.date;
      endTime = end.time;
    }
  }

  const timeZone = parseTimeZoneInput(edits.timeZone);
  if (!timeZone) {
    errors.push(
      AMBIGUOUS_ZONE_ABBREVIATIONS.has(edits.timeZone.trim().toUpperCase())
        ? `“${clean(edits.timeZone, 20)}” is ambiguous. Use a name like \`Asia/Manila\` or an offset like \`UTC+8\`.`
        : "Timezone must be a name like `Asia/Manila` / `America/New_York`, or an offset like `UTC+8`.",
    );
  }

  const location = clean(edits.location, MAX_LOCATION);
  if (!location) errors.push("Location can't be empty (use the venue or e.g. `Zoom`).");

  if (errors.length) return { errors };
  return {
    draft: {
      ...draft,
      title,
      startDate: start!.date,
      startTime: start!.time,
      endDate,
      endTime,
      timeZone,
      location,
      // The user has reviewed the details, so earlier AI caveats no longer apply.
      notes: [],
    },
  };
}

function splitDateTime(value: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = validDate(m[1]!);
  const time = validTime(m[2]!);
  return date && time && parseLocalDateTime(`${date}T${time}`) ? { date, time } : null;
}

function validDate(value: string | null): string | null {
  if (!value || !DATE_RE.test(value.trim())) return null;
  return parseLocalDateTime(`${value.trim()}T00:00`) ? value.trim() : null;
}

function validTime(value: string | null): string | null {
  const m = value ? TIME_RE.exec(value.trim()) : null;
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${m[2]}`;
}

function validUrl(value: string | null): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url.toString().length <= MAX_URL ? url.toString() : null;
  } catch {
    return null;
  }
}

function clean(value: string | null | undefined, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim();
  return truncate(text, max);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
