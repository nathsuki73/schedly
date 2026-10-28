import { handlePing } from "./commands/ping.ts";
import { ephemeral } from "./discord/responses.ts";
import {
  InteractionResponseType,
  InteractionType,
  type Interaction,
  type InteractionResponse,
} from "./discord/types.ts";
import type { Env } from "./env.ts";

export async function routeInteraction(
  interaction: Interaction,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<InteractionResponse> {
  switch (interaction.type) {
    case InteractionType.PING:
      return { type: InteractionResponseType.PONG };

    case InteractionType.APPLICATION_COMMAND:
      switch (interaction.data?.name) {
        case "ping":
          return handlePing(interaction);
        default:
          return ephemeral("Unknown command.");
      }

    default:
      return ephemeral("Unsupported interaction.");
  }
}
