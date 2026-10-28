import {
  createScheduledEvent,
  DiscordApiError,
  editOriginalResponse,
  eventLink,
  sendEphemeralFollowup,
} from "../discord/api.ts";
import { hasPermission, MANAGE_EVENTS } from "../discord/permissions.ts";
import { ephemeral, updateMessage } from "../discord/responses.ts";
import { InteractionResponseType, type Interaction, type InteractionResponse } from "../discord/types.ts";
import type { Env } from "../env.ts";
import { APPROVE_PREFIX, approvedMessage, CANCEL_PREFIX, closedMessage } from "../events/preview.ts";
import { EventRepository, type PendingEvent } from "../events/repository.ts";
import { toScheduledEventPayload } from "../events/scheduled-event.ts";
import { UserFacingError, userMessage } from "../lib/errors.ts";

/** Handles the Approve / Cancel buttons on a preview. */
export async function handleApprovalButton(
  interaction: Interaction,
  env: Env,
  ctx: ExecutionContext,
): Promise<InteractionResponse> {
  const customId = interaction.data?.custom_id ?? "";
  const action = customId.startsWith(APPROVE_PREFIX) ? "approve" : customId.startsWith(CANCEL_PREFIX) ? "cancel" : null;
  const pendingId = customId.slice(customId.indexOf(":") + 1);
  if (!action || !pendingId) return ephemeral("Unknown button.");

  const member = interaction.member;
  if (!interaction.guild_id || !member) return ephemeral("This button only works inside a server.");
  if (!hasPermission(member, MANAGE_EVENTS)) {
    return ephemeral("🔒 You need the **Manage Events** permission to approve or cancel event previews.");
  }

  const repo = new EventRepository(env.DB);
  const pending = await repo.getPending(pendingId);
  if (!pending || pending.guildId !== interaction.guild_id) {
    return ephemeral("This preview no longer exists. Run `/schedule` again.");
  }

  const now = Date.now();
  if (pending.status === "pending" && pending.expiresAt <= now) {
    return updateMessage(closedMessage(pending, "⌛ This preview expired. Run `/schedule` again to create a new one."));
  }

  if (action === "cancel") {
    if (!(await repo.transition(pending.id, "pending", "cancelled", now))) return alreadyHandled();
    return updateMessage(closedMessage(pending, `🚫 Cancelled by <@${member.user.id}>.`));
  }

  // Claim the preview atomically so a double-click or two moderators can't create two events.
  if (!(await repo.transition(pending.id, "pending", "approving", now))) return alreadyHandled();
  ctx.waitUntil(completeApproval(env, interaction.token, pending, member.user));
  return { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE };
}

function alreadyHandled(): InteractionResponse {
  return ephemeral("This preview has already been handled.");
}

export async function completeApproval(
  env: Env,
  token: string,
  pending: PendingEvent,
  approver: { id: string; username: string },
): Promise<void> {
  const repo = new EventRepository(env.DB);
  try {
    const existing = await repo.findEventByHash(pending.guildId, pending.urlHash);
    if (existing) {
      await repo.transition(pending.id, "approving", "cancelled");
      await editOriginalResponse(
        env,
        token,
        closedMessage(pending, `ℹ️ This event was already scheduled: ${eventLink(pending.guildId, existing.id)}`),
      );
      return;
    }

    if (Date.parse(pending.startTime) <= Date.now()) {
      await repo.transition(pending.id, "approving", "cancelled");
      await editOriginalResponse(env, token, closedMessage(pending, "⌛ This event has already started, so it can't be scheduled.", "error"));
      return;
    }

    const created = await createScheduledEvent(
      env,
      pending.guildId,
      toScheduledEventPayload(pending),
      `Approved by ${approver.username} via Schedly`,
    ).catch((err: unknown) => {
      throw toUserFacing(err);
    });

    await repo.recordEvent({
      id: created.id,
      guildId: pending.guildId,
      urlHash: pending.urlHash,
      sourceUrl: pending.sourceUrl,
      title: pending.title,
      startTime: pending.startTime,
      approvedBy: approver.id,
      pendingId: pending.id,
    });
    await repo.transition(pending.id, "approving", "approved");
    await editOriginalResponse(env, token, approvedMessage(pending, created.id, approver.id));
  } catch (err) {
    if (!(err instanceof UserFacingError)) console.error("approval failed", err);
    // Release the claim so a moderator can retry (e.g. after fixing the bot's permissions).
    await repo.transition(pending.id, "approving", "pending").catch(() => undefined);
    await sendEphemeralFollowup(env, token, `❌ ${userMessage(err)}`).catch((e: unknown) =>
      console.error("failed to report approval error", e),
    );
  }
}

function toUserFacing(err: unknown): unknown {
  if (!(err instanceof DiscordApiError)) return err;
  if (err.status === 403 || err.code === 50013) {
    return new UserFacingError(
      "I don't have permission to create events here. Give Schedly the **Create Events** (or **Manage Events**) permission and try again.",
    );
  }
  if (err.status === 400) {
    return new UserFacingError(`Discord rejected the event: ${err.message.slice(0, 200)}`);
  }
  return err;
}
