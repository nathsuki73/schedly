// Thin Discord REST client (fetch only). https://discord.com/developers/docs/reference
import type { Env } from "../env.ts";
import { NO_MENTIONS } from "./responses.ts";
import { MessageFlags, type MessagePayload } from "./types.ts";

export const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "DiscordBot (https://github.com/schedly, 1.0.0)";

export class DiscordApiError extends Error {
  override name = "DiscordApiError";
  constructor(
    readonly status: number,
    /** Discord JSON error code, e.g. 50013 Missing Permissions. */
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function discordFetch<T>(path: string, init: RequestInit & { auth?: boolean; env: Env }): Promise<T> {
  const { auth = true, env, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("user-agent", USER_AGENT);
  if (rest.body) headers.set("content-type", "application/json");
  if (auth) headers.set("authorization", `Bot ${env.DISCORD_BOT_TOKEN}`);

  const res = await fetch(`${DISCORD_API}${path}`, { ...rest, headers });
  if (!res.ok) {
    const body = await res.json<{ code?: number; message?: string }>().catch(() => null);
    throw new DiscordApiError(res.status, body?.code, body?.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Edits the original interaction response (works for deferred command and component responses). */
export function editOriginalResponse(env: Env, token: string, payload: MessagePayload): Promise<unknown> {
  return discordFetch(`/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
    env,
    auth: false,
    method: "PATCH",
    body: JSON.stringify({ allowed_mentions: NO_MENTIONS, ...payload }),
  });
}

/** Sends an ephemeral follow-up message visible only to the interacting user. */
export function sendEphemeralFollowup(env: Env, token: string, content: string): Promise<unknown> {
  return discordFetch(`/webhooks/${env.DISCORD_APPLICATION_ID}/${token}`, {
    env,
    auth: false,
    method: "POST",
    body: JSON.stringify({ content, flags: MessageFlags.EPHEMERAL, allowed_mentions: NO_MENTIONS }),
  });
}

export interface ScheduledEventPayload {
  name: string;
  description?: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  privacy_level: 2;
  entity_type: 3;
  entity_metadata: { location: string };
}

export function createScheduledEvent(
  env: Env,
  guildId: string,
  payload: ScheduledEventPayload,
  auditReason: string,
): Promise<{ id: string }> {
  return discordFetch(`/guilds/${guildId}/scheduled-events`, {
    env,
    method: "POST",
    headers: { "x-audit-log-reason": encodeURIComponent(auditReason.slice(0, 400)) },
    body: JSON.stringify(payload),
  });
}

export function eventLink(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}
