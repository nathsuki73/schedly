import { editOriginalResponse, eventLink } from "../discord/api.ts";
import { deferred, ephemeral } from "../discord/responses.ts";
import type { Attachment, Interaction, InteractionResponse } from "../discord/types.ts";
import type { Env } from "../env.ts";
import { eventKey } from "../events/dedupe.ts";
import { pickerMessage, reviewMessage } from "../events/preview.ts";
import { EventRepository } from "../events/repository.ts";
import { resolveDraft, type EventDraft } from "../extraction/draft.ts";
import { extractDrafts } from "../extraction/extract.ts";
import { downloadImage, sha256Hex, validateAttachment } from "../extraction/image.ts";
import { UserFacingError, userMessage } from "../lib/errors.ts";
import { AMBIGUOUS_ZONE_ABBREVIATIONS, parseTimeZoneInput } from "../lib/time.ts";

/**
 * /schedule image:<attachment> [timezone:<zone>]
 * Cheap checks run inline so errors are immediate and private. The slow part
 * (download + AI) runs after a deferred ephemeral response, then edits it into a preview.
 */
export async function handleSchedule(
  interaction: Interaction,
  env: Env,
  ctx: ExecutionContext,
): Promise<InteractionResponse> {
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user.id;
  if (!guildId || !userId) return ephemeral("`/schedule` can only be used inside a server.");

  const attachmentId = stringOption(interaction, "image");
  let attachment: Attachment;
  try {
    attachment = validateAttachment(attachmentId ? interaction.data?.resolved?.attachments?.[attachmentId] : undefined);
  } catch (err) {
    return ephemeral(`❌ ${userMessage(err)}`);
  }

  const timeZoneInput = stringOption(interaction, "timezone")?.trim();
  const timeZone = timeZoneInput ? parseTimeZoneInput(timeZoneInput) : null;
  if (timeZoneInput && !timeZone) {
    const shown = timeZoneInput.slice(0, 50);
    return ephemeral(
      AMBIGUOUS_ZONE_ABBREVIATIONS.has(timeZoneInput.toUpperCase())
        ? `❌ \`${shown}\` is ambiguous. Use a name like \`Asia/Manila\` or an offset like \`UTC+8\`.`
        : `❌ \`${shown}\` isn't a recognized timezone. Use a name like \`Asia/Manila\` / \`America/New_York\` or an offset like \`UTC+8\`.`,
    );
  }

  ctx.waitUntil(
    buildPreview(env, interaction.token, {
      attachment,
      guildId,
      userId,
      channelId: interaction.channel_id ?? null,
      timeZone,
    }),
  );
  return deferred({ ephemeral: true });
}

interface PreviewRequest {
  attachment: Attachment;
  guildId: string;
  userId: string;
  channelId: string | null;
  timeZone: string | null;
}

export async function buildPreview(env: Env, token: string, req: PreviewRequest, now = Date.now()): Promise<void> {
  const repo = new EventRepository(env.DB);
  try {
    const image = await downloadImage(req.attachment);
    const imageHash = await sha256Hex(image.bytes);

    if (await repo.findActivePendingByImage(req.guildId, imageHash, now)) {
      throw new UserFacingError(
        "This image already has a preview waiting for confirmation. Finish or cancel that one first.",
      );
    }

    const drafts = await extractDrafts(env, image, { fallbackTimeZone: req.timeZone, now });
    const { fresh, scheduledLinks } = await splitAlreadyScheduled(repo, req.guildId, drafts, now);

    if (fresh.length === 0) {
      throw new UserFacingError(
        `${scheduledLinks.length === 1 ? "This event is" : "All events in this image are"} already scheduled:\n${scheduledLinks.join("\n")}`,
      );
    }
    if (scheduledLinks.length && fresh.length === 1) {
      fresh[0]!.notes.push(`Other events from this image are already scheduled: ${scheduledLinks.join(" ")}`);
    }

    const pending = await repo.createPending(
      {
        guildId: req.guildId,
        channelId: req.channelId,
        requestedBy: req.userId,
        imageHash,
        draft: fresh.length === 1 ? fresh[0]! : null,
        candidates: fresh,
      },
      now,
    );
    await editOriginalResponse(env, token, pending.draft ? reviewMessage(pending, pending.draft, now) : pickerMessage(pending));
    await repo.purgeExpired(now);
  } catch (err) {
    if (!(err instanceof UserFacingError)) console.error("schedule failed", err);
    await editOriginalResponse(env, token, { content: `❌ ${userMessage(err)}` }).catch((e: unknown) =>
      console.error("failed to report schedule error", e),
    );
  }
}

/** Separates drafts that already exist as Discord events in this server. */
async function splitAlreadyScheduled(repo: EventRepository, guildId: string, drafts: EventDraft[], now: number) {
  const fresh: EventDraft[] = [];
  const scheduledLinks: string[] = [];
  for (const draft of drafts) {
    const { event } = resolveDraft(draft, now);
    const existing = event ? await repo.findEventByKey(guildId, eventKey(event.title, event.startTime)) : null;
    if (existing) scheduledLinks.push(eventLink(guildId, existing.id));
    else fresh.push(draft);
  }
  return { fresh, scheduledLinks };
}

function stringOption(interaction: Interaction, name: string): string | undefined {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}
