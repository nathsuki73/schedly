// Slash command definitions. Shared by the Worker and scripts/register-commands.ts,
// so this file must stay free of imports.

/** MANAGE_EVENTS permission bit. */
export const MANAGE_EVENTS = 1n << 33n;

const STRING = 3;
const ATTACHMENT = 11;

export const PING_COMMAND = {
  name: "ping",
  description: "Check whether Schedly is online.",
  type: 1,
};

export const SCHEDULE_COMMAND = {
  name: "schedule",
  description: "Turn an event poster or screenshot into a Discord scheduled event.",
  type: 1,
  // Guild-only, and hidden from members without Manage Events (admins can override in server settings).
  contexts: [0],
  default_member_permissions: MANAGE_EVENTS.toString(),
  options: [
    {
      name: "image",
      description: "Event poster, announcement, or screenshot (PNG, JPG, or WebP).",
      type: ATTACHMENT,
      required: true,
    },
    {
      name: "timezone",
      description: "Timezone to use if the image doesn't state one clearly, e.g. Asia/Manila or UTC+8.",
      type: STRING,
      required: false,
    },
  ],
};

export const COMMANDS = [PING_COMMAND, SCHEDULE_COMMAND];
