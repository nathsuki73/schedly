// Handles everything a user can do on a preview: pick an event, Edit Details (modal),
// Confirm & Create Event, and Cancel.
import {
  createScheduledEvent,
  DiscordApiError,
  editOriginalResponse,
  eventLink,
  sendEphemeralFollowup,
} from "../discord/api.ts";
import { hasPermission, MANAGE_EVENTS } from "../discord/permissions.ts";
import { ephemeral, modal, updateMessage } from "../discord/responses.ts";
import { InteractionResponseType, type Interaction, type InteractionResponse } from "../discord/types.ts";
import type { Env } from "../env.ts";
import { eventKey } from "../events/dedupe.ts";
import {
  Action,
  closedMessage,
  createdMessage,
  EDIT_FIELDS,
  editModal,
  pickerMessage,
  reviewMessage,
  type ActionName,
} from "../events/preview.ts";
import { EventRepository, type PendingEvent } from "../events/repository.ts";
import { toScheduledEventPayload } from "../events/scheduled-event.ts";
import { applyEdits, resolveDraft, type EventDraft, type ResolvedEvent } from "../extraction/draft.ts";
import { UserFacingError, userMessage } from "../lib/errors.ts";

const ACTIONS = new Set<string>(Object.values(Action));

type Loaded = { pending: PendingEvent; repo: EventRepository; userId: string; username: string };

/**
 * Shared guard for every preview interaction: parses the custom_id, checks permissions,
 * and loads the preview. Returns an error response when the interaction can't proceed.
 */
async function load(interaction: Interaction, env: Env): Promise<{ action: ActionName; ctx: Loaded } | InteractionResponse> {
  const customId = interaction.data?.custom_id ?? "";
  const sep = customId.indexOf(":");
  const action = customId.slice(0, sep);
  const pendingId = customId.slice(sep + 1);
  if (sep < 0 || !ACTIONS.has(action) || !pendingId) return ephemeral("Unknown action.");

  const member = interaction.member;
  if (!interaction.guild_id || !member) return ephemeral("This only works inside a server.");
  if (!hasPermission(member, MANAGE_EVENTS)) {
    return ephemeral("🔒 You need the **Manage Events** permission to schedule events.");
  }

  const repo = new EventRepository(env.DB);
  const pending = await repo.getPending(pendingId);
  if (!pending || pending.guildId !== interaction.guild_id) {
    return ephemeral("This preview no longer exists. Run `/schedule` again.");
  }
  if (pending.status !== "pending") return ephemeral("This preview has already been handled.");
  if (pending.expiresAt <= Date.now()) {
    return updateMessage(closedMessage("⌛ This preview expired. Run `/schedule` again.", pending.draft));
  }
  return { action: action as ActionName, ctx: { pending, repo, userId: member.user.id, username: member.user.username } };
}

/** Buttons and the event picker. */
export async function handlePreviewComponent(
  interaction: Interaction,
  env: Env,
  execution: ExecutionContext,
): Promise<InteractionResponse> {
  const loaded = await load(interaction, env);
  if (!("action" in loaded)) return loaded;
  const { action, ctx } = loaded;
  const { pending, repo } = ctx;

  switch (action) {
    case Action.CANCEL:
      if (!(await repo.transition(pending.id, "pending", "cancelled"))) return alreadyHandled();
      return updateMessage(closedMessage("🚫 Cancelled. No event was created.", pending.draft));

    case Action.PICK: {
      const index = Number(interaction.data?.values?.[0]);
      const draft = Number.isInteger(index) ? pending.candidates[index] : undefined;
      if (!draft) return updateMessage(pickerMessage(pending));
      if (!(await repo.updateDraft(pending.id, draft))) return alreadyHandled();
      return updateMessage(reviewMessage(pending, draft));
    }

    case Action.EDIT:
      if (!pending.draft) return ephemeral("Pick an event from the list first.");
      return modal(editModal(pending.id, pending.draft));

    case Action.CONFIRM: {
      if (!pending.draft) return ephemeral("Pick an event from the list first.");
      const { event } = resolveDraft(pending.draft);
      if (!event) {
        // Details may have gone stale (e.g. the start time passed); re-render with what's needed.
        return updateMessage(reviewMessage(pending, pending.draft));
      }
      // Claim the preview atomically so a double-click can't create two events.
      if (!(await repo.transition(pending.id, "pending", "approving"))) return alreadyHandled();
      execution.waitUntil(completeConfirmation(env, interaction.token, pending, pending.draft, event, ctx));
      return { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE };
    }

    default:
      return ephemeral("Unknown action.");
  }
}

/** Submission of the Edit Details modal. */
export async function handleEditSubmit(interaction: Interaction, env: Env): Promise<InteractionResponse> {
  const loaded = await load(interaction, env);
  if (!("action" in loaded)) return loaded;
  const { action, ctx } = loaded;
  const { pending, repo } = ctx;
  if (action !== Action.EDIT_FORM || !pending.draft) return ephemeral("Unknown action.");

  const values = new Map(
    (interaction.data?.components ?? []).flatMap((row) => row.components.map((c) => [c.custom_id, c.value ?? ""] as const)),
  );
  const result = applyEdits(pending.draft, {
    title: values.get(EDIT_FIELDS.title) ?? "",
    start: values.get(EDIT_FIELDS.start) ?? "",
    end: values.get(EDIT_FIELDS.end) ?? "",
    timeZone: values.get(EDIT_FIELDS.timeZone) ?? "",
    location: values.get(EDIT_FIELDS.location) ?? "",
  });
  if ("errors" in result) {
    return ephemeral(`Nothing was changed. Please fix:\n${result.errors.map((e) => `• ${e}`).join("\n")}`);
  }
  if (!(await repo.updateDraft(pending.id, result.draft))) return alreadyHandled();
  return updateMessage(reviewMessage(pending, result.draft));
}

function alreadyHandled(): InteractionResponse {
  return ephemeral("This preview has already been handled.");
}

export async function completeConfirmation(
  env: Env,
  token: string,
  pending: PendingEvent,
  draft: EventDraft,
  event: ResolvedEvent,
  who: { userId: string; username: string },
): Promise<void> {
  const repo = new EventRepository(env.DB);
  const dedupeKey = eventKey(event.title, event.startTime);
  try {
    const existing = await repo.findEventByKey(pending.guildId, dedupeKey);
    if (existing) {
      await repo.transition(pending.id, "approving", "cancelled");
      await editOriginalResponse(
        env,
        token,
        closedMessage(`ℹ️ This event is already scheduled: ${eventLink(pending.guildId, existing.id)}`, draft),
      );
      return;
    }

    const created = await createScheduledEvent(
      env,
      pending.guildId,
      toScheduledEventPayload(event),
      `Created by ${who.username} via Schedly`,
    ).catch((err: unknown) => {
      throw toUserFacing(err);
    });

    await repo.recordEvent({
      id: created.id,
      guildId: pending.guildId,
      dedupeKey,
      title: event.title,
      startTime: event.startTime,
      approvedBy: who.userId,
      pendingId: pending.id,
    });
    await repo.transition(pending.id, "approving", "approved");
    await editOriginalResponse(env, token, createdMessage(event, draft, pending.guildId, created.id));
  } catch (err) {
    if (!(err instanceof UserFacingError)) console.error("event creation failed", err);
    // Release the claim so the user can retry (e.g. after fixing the bot's permissions).
    await repo.transition(pending.id, "approving", "pending").catch(() => undefined);
    await sendEphemeralFollowup(env, token, `❌ ${userMessage(err)}`).catch((e: unknown) =>
      console.error("failed to report creation error", e),
    );
  }
}

function toUserFacing(err: unknown): unknown {
  if (!(err instanceof DiscordApiError)) return err;
  if (err.status === 403 || err.code === 50013) {
    return new UserFacingError(
      "I don't have permission to create events in this server. Ask an admin to give Schedly the **Create Events** and **Manage Events** permissions, then press Confirm again.",
    );
  }
  if (err.status === 400) {
    return new UserFacingError(`Discord rejected the event: ${err.message.slice(0, 200)}. Use **Edit Details** to adjust it.`);
  }
  return err;
}
