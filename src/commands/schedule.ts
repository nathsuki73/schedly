import { editOriginalResponse, eventLink } from "../discord/api.ts";
import { deferred, ephemeral } from "../discord/responses.ts";
import type { Interaction, InteractionResponse } from "../discord/types.ts";
import type { Env } from "../env.ts";
import { hashUrl, normalizeUrl } from "../events/normalize-url.ts";
import { pendingPreview } from "../events/preview.ts";
import { EventRepository } from "../events/repository.ts";
import { extractEvent } from "../extraction/extract.ts";
import { UserFacingError, userMessage } from "../lib/errors.ts";
import { isValidTimeZone } from "../lib/time.ts";
import { parsePublicUrl } from "../lib/url-safety.ts";

/**
 * /schedule url:<link> [timezone:<IANA>]
 * Cheap checks run inline so errors are immediate and private; the slow part
 * (fetch + AI) runs after a deferred response, then edits it into a preview.
 */
export async function handleSchedule(
  interaction: Interaction,
  env: Env,
  ctx: ExecutionContext,
): Promise<InteractionResponse> {
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user.id;
  if (!guildId || !userId) return ephemeral("`/schedule` can only be used inside a server.");

  const rawUrl = stringOption(interaction, "url");
  const timeZone = stringOption(interaction, "timezone")?.trim();

  let url: URL;
  try {
    url = parsePublicUrl(rawUrl ?? "");
  } catch (err) {
    return ephemeral(`❌ ${userMessage(err)}`);
  }
  if (timeZone && !isValidTimeZone(timeZone)) {
    return ephemeral(`❌ \`${timeZone.slice(0, 50)}\` isn't a recognized timezone. Use an IANA name like \`Asia/Manila\` or \`America/New_York\`.`);
  }

  const repo = new EventRepository(env.DB);
  const urlHash = await hashUrl(normalizeUrl(url));

  const existing = await repo.findEventByHash(guildId, urlHash);
  if (existing) {
    return ephemeral(`ℹ️ This event is already scheduled: ${eventLink(guildId, existing.id)}`);
  }
  if (await repo.findActivePending(guildId, urlHash)) {
    return ephemeral("ℹ️ A preview for this link is already waiting for approval in this server.");
  }

  ctx.waitUntil(
    buildPreview(env, interaction.token, {
      url,
      urlHash,
      guildId,
      userId,
      channelId: interaction.channel_id ?? null,
      timeZone,
    }),
  );
  return deferred();
}

interface PreviewRequest {
  url: URL;
  urlHash: string;
  guildId: string;
  userId: string;
  channelId: string | null;
  timeZone: string | undefined;
}

export async function buildPreview(env: Env, token: string, req: PreviewRequest): Promise<void> {
  const repo = new EventRepository(env.DB);
  try {
    const event = await extractEvent(env, req.url, { fallbackTimeZone: req.timeZone });

    const similar = await repo.findSimilarEvent(req.guildId, event.title, event.startTime);
    if (similar) {
      event.warnings.unshift(`A matching event already exists: ${eventLink(req.guildId, similar.id)}`);
    }

    const pending = await repo.createPending({
      guildId: req.guildId,
      channelId: req.channelId,
      requestedBy: req.userId,
      sourceUrl: req.url.toString(),
      urlHash: req.urlHash,
      ...event,
    });
    await editOriginalResponse(env, token, pendingPreview(pending));
    await repo.purgeExpired();
  } catch (err) {
    if (!(err instanceof UserFacingError)) console.error("schedule failed", err);
    await editOriginalResponse(env, token, { content: `❌ ${userMessage(err)}` }).catch((e: unknown) =>
      console.error("failed to report schedule error", e),
    );
  }
}

function stringOption(interaction: Interaction, name: string): string | undefined {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}
