// Message builders for each stage of a preview's life: pending → approved / cancelled.
import { eventLink } from "../discord/api.ts";
import { ButtonStyle, ComponentType, type Embed, type MessagePayload } from "../discord/types.ts";
import type { PendingEvent } from "./repository.ts";

const COLORS = { pending: 0x5865f2, approved: 0x57f287, cancelled: 0x99aab5, error: 0xed4245 } as const;

export const APPROVE_PREFIX = "approve:";
export const CANCEL_PREFIX = "cancel:";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function eventEmbed(pending: PendingEvent, color: number): Embed {
  const fields: NonNullable<Embed["fields"]> = [
    { name: "Starts", value: `<t:${unix(pending.startTime)}:F> (<t:${unix(pending.startTime)}:R>)`, inline: false },
    { name: "Ends", value: `<t:${unix(pending.endTime)}:F>`, inline: false },
    { name: "Location", value: pending.location, inline: false },
  ];
  if (pending.warnings.length) {
    fields.push({ name: "⚠️ Please check", value: pending.warnings.map((w) => `• ${w}`).join("\n").slice(0, 1024) });
  }
  return {
    title: pending.title,
    url: pending.sourceUrl,
    description: pending.description ?? undefined,
    color,
    fields,
  };
}

export function pendingPreview(pending: PendingEvent): MessagePayload {
  return {
    content: `📅 Event preview requested by <@${pending.requestedBy}>. A moderator with **Manage Events** can approve it.`,
    embeds: [{ ...eventEmbed(pending, COLORS.pending), footer: { text: "Preview expires in 24 hours" } }],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          { type: ComponentType.BUTTON, style: ButtonStyle.SUCCESS, label: "Approve", custom_id: `${APPROVE_PREFIX}${pending.id}` },
          { type: ComponentType.BUTTON, style: ButtonStyle.DANGER, label: "Cancel", custom_id: `${CANCEL_PREFIX}${pending.id}` },
        ],
      },
    ],
  };
}

export function approvedMessage(pending: PendingEvent, eventId: string, approverId: string): MessagePayload {
  return {
    content: `✅ Scheduled by <@${approverId}>.`,
    embeds: [eventEmbed({ ...pending, warnings: [] }, COLORS.approved)],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [{ type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: "View event", url: eventLink(pending.guildId, eventId) }],
      },
    ],
  };
}

export function closedMessage(pending: PendingEvent, reason: string, kind: "cancelled" | "error" = "cancelled"): MessagePayload {
  return {
    content: reason,
    embeds: [eventEmbed({ ...pending, warnings: [] }, COLORS[kind])],
    components: [],
  };
}
