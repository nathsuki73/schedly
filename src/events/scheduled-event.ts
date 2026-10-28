import type { ScheduledEventPayload } from "../discord/api.ts";
import { truncate, type ResolvedEvent } from "../extraction/draft.ts";

const MAX_DISCORD_DESCRIPTION = 1000;

/**
 * Maps a confirmed event to a Discord EXTERNAL scheduled event. EXTERNAL covers both
 * in-person venues and online platforms (the other entity types are Discord voice/stage channels).
 */
export function toScheduledEventPayload(event: ResolvedEvent): ScheduledEventPayload {
  const extras = [
    event.organizer ? `Organized by ${event.organizer}` : null,
    event.registrationUrl ? `🔗 Register: ${event.registrationUrl}` : null,
  ].filter(Boolean);
  const extrasText = extras.length ? `\n\n${extras.join("\n")}` : "";
  const room = MAX_DISCORD_DESCRIPTION - extrasText.length;
  const body = event.description && room > 20 ? truncate(event.description, room) : "";
  const description = truncate(`${body}${extrasText}`.trim(), MAX_DISCORD_DESCRIPTION);

  return {
    name: event.title,
    ...(description ? { description } : {}),
    scheduled_start_time: event.startTime,
    scheduled_end_time: event.endTime,
    privacy_level: 2, // GUILD_ONLY
    entity_type: 3, // EXTERNAL
    entity_metadata: { location: event.location },
  };
}
