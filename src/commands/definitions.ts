// Slash command definitions. Shared by the Worker and scripts/register-commands.ts,
// so this file must stay free of imports.

/** MANAGE_EVENTS permission bit. */
export const MANAGE_EVENTS = 1n << 33n;

export const PING_COMMAND = {
  name: "ping",
  description: "Check whether Schedly is online.",
  type: 1,
};

export const SCHEDULE_COMMAND = {
  name: "schedule",
  description: "Turn an event link into a Discord scheduled event.",
  type: 1,
  // Guild-only, and hidden from members without Manage Events (admins can override in server settings).
  contexts: [0],
  default_member_permissions: MANAGE_EVENTS.toString(),
  options: [
    {
      name: "url",
      description: "Public link to the webinar, seminar, workshop, or event page.",
      type: 3,
      required: true,
    },
    {
      name: "timezone",
      description: "IANA timezone to assume if the page has none, e.g. Asia/Manila (default UTC).",
      type: 3,
      required: false,
    },
  ],
};

export const COMMANDS = [PING_COMMAND, SCHEDULE_COMMAND];
