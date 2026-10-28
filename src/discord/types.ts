// Minimal subset of the Discord interaction payloads Schedly relies on.
// Reference: https://discord.com/developers/docs/interactions/receiving-and-responding

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
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
  value?: string | number | boolean;
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
    custom_id?: string;
    component_type?: number;
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

export interface ActionRow {
  type: typeof ComponentType.ACTION_ROW;
  components: Button[];
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
}

export interface InteractionResponse {
  type: number;
  data?: MessagePayload;
}
