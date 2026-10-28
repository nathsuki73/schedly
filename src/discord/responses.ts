import {
  InteractionResponseType,
  MessageFlags,
  type InteractionResponse,
  type MessagePayload,
  type ModalPayload,
} from "./types.ts";

/** Never let bot output ping @everyone, roles, or users. */
export const NO_MENTIONS = { parse: [] as string[] };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function message(data: MessagePayload): InteractionResponse {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { allowed_mentions: NO_MENTIONS, ...data },
  };
}

export function ephemeral(content: string): InteractionResponse {
  return message({ content, flags: MessageFlags.EPHEMERAL });
}

export function updateMessage(data: MessagePayload): InteractionResponse {
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: { allowed_mentions: NO_MENTIONS, ...data },
  };
}

/** "Thinking…" placeholder; the real reply is sent later by editing @original. */
export function deferred({ ephemeral = false } = {}): InteractionResponse {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    ...(ephemeral ? { data: { flags: MessageFlags.EPHEMERAL } } : {}),
  };
}

export function modal(data: ModalPayload): InteractionResponse {
  return { type: InteractionResponseType.MODAL, data };
}
