import type { ScheduledEventPayload } from "../discord/api.ts";
import { truncate } from "../extraction/validate.ts";
import type { PendingEvent } from "./repository.ts";

const MAX_DISCORD_DESCRIPTION = 1000;

/** Maps an approved preview to a Discord EXTERNAL scheduled event. */
export function toScheduledEventPayload(pending: PendingEvent): ScheduledEventPayload {
  const footer = `\n\n🔗 ${pending.sourceUrl}`;
  const room = MAX_DISCORD_DESCRIPTION - footer.length;
  const body = pending.description && room > 20 ? truncate(pending.description, room) : "";
  const description = truncate(`${body}${footer}`.trim(), MAX_DISCORD_DESCRIPTION);

  return {
    name: pending.title,
    description,
    scheduled_start_time: pending.startTime,
    scheduled_end_time: pending.endTime,
    privacy_level: 2, // GUILD_ONLY
    entity_type: 3, // EXTERNAL
    entity_metadata: { location: pending.location },
  };
}
