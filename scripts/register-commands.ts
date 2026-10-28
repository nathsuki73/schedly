// Registers Schedly's slash commands with Discord.
// Usage: npm run register   (reads .dev.vars via --env-file)
// With DISCORD_GUILD_ID set, commands go to that guild only (instant updates);
// otherwise they're registered globally.
import { COMMANDS } from "../src/commands/definitions.ts";

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) {
  console.error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set (see .dev.vars.example).");
  process.exit(1);
}

const route = guildId
  ? `applications/${appId}/guilds/${guildId}/commands`
  : `applications/${appId}/commands`;

const res = await fetch(`https://discord.com/api/v10/${route}`, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Failed to register commands: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const registered = (await res.json()) as { name: string }[];
console.log(
  `Registered ${registered.length} command(s) ${guildId ? `to guild ${guildId}` : "globally"}: ` +
    registered.map((c) => `/${c.name}`).join(", "),
);
