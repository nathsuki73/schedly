// Minimal subset of the Discord interaction payloads Schedly relies on.
// Reference: https://discord.com/developers/docs/interactions/receiving-and-responding

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2,
} as const;

export const MessageFlags = {
  EPHEMERAL: 1 << 6,
} as const;

export interface DiscordUser {
  id: string;
  username: string;
}

export interface GuildMember {
  user: DiscordUser;
  /** Total permissions of the member in the channel, as a bitfield string. */
  permissions: string;
}

export interface CommandOption {
  name: string;
  type: number;
  /** For ATTACHMENT options this is the attachment ID, resolved via `data.resolved.attachments`. */
  value?: string | number | boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

/** Submitted modal values arrive as action rows of text inputs. */
export interface ModalRow {
  type: number;
  components: { type: number; custom_id: string; value: string }[];
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: GuildMember;
  user?: DiscordUser;
  data?: {
    name?: string;
    options?: CommandOption[];
    resolved?: { attachments?: Record<string, Attachment> };
    custom_id?: string;
    component_type?: number;
    /** Selected values of a select menu. */
    values?: string[];
    /** Modal submissions. */
    components?: ModalRow[];
  };
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export interface Button {
  type: typeof ComponentType.BUTTON;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface StringSelect {
  type: typeof ComponentType.STRING_SELECT;
  custom_id: string;
  placeholder?: string;
  options: { label: string; value: string; description?: string }[];
}

export interface TextInput {
  type: typeof ComponentType.TEXT_INPUT;
  custom_id: string;
  label: string;
  style: number;
  required?: boolean;
  value?: string;
  placeholder?: string;
  min_length?: number;
  max_length?: number;
}

export interface ActionRow {
  type: typeof ComponentType.ACTION_ROW;
  components: (Button | StringSelect)[];
}

export interface ModalActionRow {
  type: typeof ComponentType.ACTION_ROW;
  components: [TextInput];
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
}

export interface ModalPayload {
  custom_id: string;
  title: string;
  components: ModalActionRow[];
}

export interface InteractionResponse {
  type: number;
  data?: MessagePayload | ModalPayload;
}
