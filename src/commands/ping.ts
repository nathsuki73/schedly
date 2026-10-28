import { ephemeral } from "../discord/responses.ts";
import { snowflakeTimestamp } from "../discord/snowflake.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";

export function handlePing(interaction: Interaction, now = Date.now()): InteractionResponse {
  const latency = Math.max(0, now - snowflakeTimestamp(interaction.id));
  return ephemeral(`🏓 Pong! Schedly is online. (${latency} ms)`);
}
