// Message and modal builders for each stage of a preview:
// (pick one of several events) → review / edit → created or cancelled.
import { eventLink } from "../discord/api.ts";
import {
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type ActionRow,
  type Embed,
  type MessagePayload,
  type ModalPayload,
  type TextInput,
} from "../discord/types.ts";
import { resolveDraft, truncate, type EventDraft, type ResolvedEvent } from "../extraction/draft.ts";
import { formatZone } from "../lib/time.ts";
import type { PendingEvent } from "./repository.ts";

const COLORS = { review: 0x5865f2, incomplete: 0xfee75c, created: 0x57f287, closed: 0x99aab5, error: 0xed4245 } as const;

/** custom_id prefixes; the pending preview ID follows the colon. */
export const Action = {
  CONFIRM: "confirm",
  EDIT: "edit",
  CANCEL: "cancel",
  PICK: "pick",
  EDIT_FORM: "editform",
} as const;
export type ActionName = (typeof Action)[keyof typeof Action];

export const EDIT_FIELDS = { title: "title", start: "start", end: "end", timeZone: "timezone", location: "location" } as const;

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const id = (action: ActionName, pendingId: string) => `${action}:${pendingId}`;

/** The date/time as written on the poster, with ❓ for anything missing. */
export function whenText(d: EventDraft): string {
  const start = `${d.startDate ?? "❓ date"} ${d.startTime ?? "❓ time"}`;
  const end = d.endTime ? ` – ${d.endDate && d.endDate !== d.startDate ? `${d.endDate} ` : ""}${d.endTime}` : "";
  const zone = d.timeZone ? formatZone(d.timeZone) : d.timeZoneText ? `❓ “${d.timeZoneText}”` : "❓ timezone";
  return `${start}${end} (${zone})`;
}

function draftEmbed(d: EventDraft, resolved: ResolvedEvent | null, color: number): Embed {
  const fields: NonNullable<Embed["fields"]> = [{ name: "When (as shown)", value: whenText(d) }];
  if (resolved) {
    fields.push(
      { name: "Starts", value: `<t:${unix(resolved.startTime)}:F> (<t:${unix(resolved.startTime)}:R>)`, inline: true },
      { name: "Ends", value: `<t:${unix(resolved.endTime)}:F>`, inline: true },
    );
  }
  const where = resolved?.location ?? d.location;
  fields.push({
    name: d.isOnline ? "🌐 Online" : d.isOnline === false ? "📍 In person" : "Location",
    value: where ?? "❓ Not shown",
  });
  if (d.organizer) fields.push({ name: "Organizer", value: d.organizer, inline: true });
  if (d.registrationUrl) fields.push({ name: "Registration", value: d.registrationUrl, inline: true });
  return {
    title: d.title ?? "❓ Untitled event",
    description: d.description ?? undefined,
    color,
    fields,
  };
}

/** The review screen for a single draft, with Confirm / Edit / Cancel. */
export function reviewMessage(pending: PendingEvent, draft: EventDraft, now = Date.now()): MessagePayload {
  const { event, missing, assumptions } = resolveDraft(draft, now);
  const embed = draftEmbed(draft, event, missing.length ? COLORS.incomplete : COLORS.review);
  if (missing.length) {
    embed.fields!.push({ name: "❗ Needs your input", value: missing.map((m) => `• ${m}`).join("\n") });
  }
  const checks = [...draft.notes, ...assumptions];
  if (checks.length) {
    embed.fields!.push({ name: "⚠️ Please check", value: truncate(checks.map((c) => `• ${c}`).join("\n"), 1024) });
  }
  embed.footer = { text: "Preview expires in 24 hours" };

  return {
    content: missing.length
      ? "Some details are missing. Use **Edit Details** to fill them in. I won't guess them."
      : "Here's what I found. Review it, then confirm to create the Discord event.",
    embeds: [embed],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          { type: ComponentType.BUTTON, style: ButtonStyle.SUCCESS, label: "Confirm & Create Event", custom_id: id(Action.CONFIRM, pending.id), disabled: missing.length > 0 },
          { type: ComponentType.BUTTON, style: ButtonStyle.PRIMARY, label: "Edit Details", custom_id: id(Action.EDIT, pending.id) },
          { type: ComponentType.BUTTON, style: ButtonStyle.DANGER, label: "Cancel", custom_id: id(Action.CANCEL, pending.id) },
        ],
      },
    ],
  };
}

/** Shown when one image contains several distinct events. */
export function pickerMessage(pending: PendingEvent): MessagePayload {
  const list = pending.candidates
    .map((d, i) => `**${i + 1}.** ${d.title ?? "Untitled event"} · ${whenText(d)}`)
    .join("\n");
  const rows: ActionRow[] = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.STRING_SELECT,
          custom_id: id(Action.PICK, pending.id),
          placeholder: "Choose an event to schedule",
          options: pending.candidates.map((d, i) => ({
            label: truncate(`${i + 1}. ${d.title ?? "Untitled event"}`, 100),
            description: truncate(whenText(d), 100),
            value: String(i),
          })),
        },
      ],
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [{ type: ComponentType.BUTTON, style: ButtonStyle.DANGER, label: "Cancel", custom_id: id(Action.CANCEL, pending.id) }],
    },
  ];
  return {
    content: `I found **${pending.candidates.length} events** in this image. Pick the one to schedule. You can run \`/schedule\` again with the same image for the others.`,
    embeds: [{ title: "Events in this image", description: truncate(list, 4000), color: COLORS.review }],
    components: rows,
  };
}

export function createdMessage(event: ResolvedEvent, draft: EventDraft, guildId: string, eventId: string): MessagePayload {
  return {
    content: `✅ Event created: ${eventLink(guildId, eventId)}`,
    embeds: [draftEmbed({ ...draft, notes: [] }, event, COLORS.created)],
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [{ type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: "View event", url: eventLink(guildId, eventId) }],
      },
    ],
  };
}

export function closedMessage(reason: string, draft?: EventDraft | null, kind: "closed" | "error" = "closed"): MessagePayload {
  return {
    content: reason,
    embeds: draft ? [draftEmbed({ ...draft, notes: [] }, null, COLORS[kind])] : [],
    components: [],
  };
}

/** Edit Details form, prefilled with the current draft. Discord allows 5 inputs per modal. */
export function editModal(pendingId: string, d: EventDraft): ModalPayload {
  const input = (custom_id: string, label: string, value: string | null, extra: Partial<TextInput> = {}) => ({
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.TEXT_INPUT,
        custom_id,
        label,
        style: TextInputStyle.SHORT,
        required: true,
        max_length: 100,
        ...(value ? { value: truncate(value, extra.max_length ?? 100) } : {}),
        ...extra,
      } satisfies TextInput,
    ] as [TextInput],
  });
  const start = d.startDate && d.startTime ? `${d.startDate} ${d.startTime}` : (d.startDate ?? "");
  const end = d.endTime ? (d.endDate && d.endDate !== d.startDate ? `${d.endDate} ${d.endTime}` : d.endTime) : "";

  return {
    custom_id: id(Action.EDIT_FORM, pendingId),
    title: "Edit event details",
    components: [
      input(EDIT_FIELDS.title, "Title", d.title),
      input(EDIT_FIELDS.start, "Start · YYYY-MM-DD HH:mm (24-hour)", start, { placeholder: "2026-11-08 14:00", max_length: 16 }),
      input(EDIT_FIELDS.end, "End · YYYY-MM-DD HH:mm or HH:mm (optional)", end, {
        required: false,
        placeholder: "16:00",
        max_length: 16,
      }),
      input(EDIT_FIELDS.timeZone, "Timezone · e.g. Asia/Manila or UTC+8", d.timeZone, {
        placeholder: "Asia/Manila",
        max_length: 64,
      }),
      input(EDIT_FIELDS.location, "Location · venue or platform (e.g. Zoom)", d.location),
    ],
  };
}
