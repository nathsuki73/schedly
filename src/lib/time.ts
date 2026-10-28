// Timezone math without dependencies, using the runtime's Intl/ICU data.

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** Parses a wall-clock "YYYY-MM-DDTHH:mm[:ss]" string (any trailing offset is ignored). */
export function parseLocalDateTime(value: string): LocalDateTime | null {
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => Number(v ?? 0)) as [
    number, number, number, number, number, number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Reject overflowed values such as 2026-02-31 or 25:00.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Parses "Z", "+08:00", "+0800", or "-05" into minutes east of UTC. */
export function parseUtcOffset(value: string): number | null {
  const v = value.trim();
  if (v === "Z" || v === "+00:00" || v === "-00:00") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(v);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? 0);
  if (hours > 14 || minutes > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

export type Zone = { offsetMinutes: number } | { timeZone: string };

/** Converts a wall-clock time in the given zone to a UTC epoch (ms). */
export function localToUtcMs(local: LocalDateTime, zone: Zone): number {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  if ("offsetMinutes" in zone) return wall - zone.offsetMinutes * 60000;
  // Two passes settle the offset correctly around DST transitions.
  const guess = wall - zoneOffsetMinutes(zone.timeZone, wall) * 60000;
  return wall - zoneOffsetMinutes(zone.timeZone, guess) * 60000;
}

// --- Timezone input -------------------------------------------------------------------------
// Zones are stored as strings: an IANA name ("Asia/Manila") or a fixed offset ("+08:00").

/** Abbreviations that name different zones in different regions (e.g. PST = Pacific or Philippine). */
export const AMBIGUOUS_ZONE_ABBREVIATIONS = new Set(["PST", "CST", "IST", "BST", "AST", "MST", "ECT"]);

const ZONE_ALIASES: Record<string, string> = {
  PHT: "Asia/Manila",
  PHST: "Asia/Manila",
  "PHILIPPINE TIME": "Asia/Manila",
  "PHILIPPINE STANDARD TIME": "Asia/Manila",
  PHILIPPINES: "Asia/Manila",
  MANILA: "Asia/Manila",
  SGT: "Asia/Singapore",
  HKT: "Asia/Hong_Kong",
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  WIB: "Asia/Jakarta",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EDT: "America/New_York",
  PDT: "America/Los_Angeles",
  UTC: "UTC",
  GMT: "UTC",
  Z: "UTC",
};

const OFFSET_INPUT_RE = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;

/**
 * Normalizes user/AI timezone text to a stored zone string, or null if it is unknown or
 * ambiguous. Accepts IANA names, offsets ("UTC+8", "GMT+08:00", "+0530"), and common aliases.
 */
export function parseTimeZoneInput(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 64) return null;

  const upper = raw.toUpperCase().replace(/\s+/g, " ");
  if (AMBIGUOUS_ZONE_ABBREVIATIONS.has(upper)) return null;
  const alias = ZONE_ALIASES[upper];
  if (alias) return alias;

  const m = OFFSET_INPUT_RE.exec(raw);
  if (m) {
    const hours = Number(m[2]);
    const minutes = Number(m[3] ?? 0);
    if (hours > 14 || minutes > 59) return null;
    return `${m[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  if (isValidTimeZone(raw)) return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  return null;
}

export function toZone(zone: string): Zone {
  const offset = parseUtcOffset(zone);
  return offset !== null ? { offsetMinutes: offset } : { timeZone: zone };
}

/** Human-readable zone label, e.g. "Asia/Manila" or "UTC+08:00". */
export function formatZone(zone: string): string {
  return parseUtcOffset(zone) !== null ? `UTC${zone}` : zone;
}
