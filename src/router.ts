import { handlePing } from "./commands/ping.ts";
import { handleSchedule } from "./commands/schedule.ts";
import { handleEditSubmit, handlePreviewComponent } from "./components/preview-actions.ts";
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
  env: Env,
  ctx: ExecutionContext,
): Promise<InteractionResponse> {
  switch (interaction.type) {
    case InteractionType.PING:
      return { type: InteractionResponseType.PONG };

    case InteractionType.APPLICATION_COMMAND:
      switch (interaction.data?.name) {
        case "ping":
          return handlePing(interaction);
        case "schedule":
          return handleSchedule(interaction, env, ctx);
        default:
          return ephemeral("Unknown command.");
      }

    case InteractionType.MESSAGE_COMPONENT:
      return handlePreviewComponent(interaction, env, ctx);

    case InteractionType.MODAL_SUBMIT:
      return handleEditSubmit(interaction, env);

    default:
      return ephemeral("Unsupported interaction.");
  }
}
