# Schedly

An AI-powered Discord bot that turns links to webinars, seminars, workshops, and other events into **Discord Scheduled Events**.

Paste a link with `/schedule`, review the details Schedly extracts, and click **Approve**. The event appears in your server's Events tab.

- Runs on **Cloudflare Workers** (free tier) using Discord's **HTTP Interactions**, so there's no always-on gateway connection.
- Stores previews and created events in **Cloudflare D1**.
- Uses **Google Gemini** (`gemini-2.5-flash`) with structured JSON output to extract event details.
- Has **zero runtime npm dependencies**.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/ping` | Everyone | Checks that the bot is online. |
| `/schedule url:<link> [timezone:<IANA>]` | Members with **Manage Events** | Reads the event page and posts a preview with **Approve** and **Cancel** buttons. |

How it works:

1. `/schedule` checks the link straight away. It rejects private or local addresses, unknown timezones, links that are already scheduled, and links whose preview is still pending.
2. Schedly fetches the page, reduces it to its title, meta tags, JSON-LD and visible text, and asks Gemini for the title, description, start and end time, timezone and location.
3. The answer is validated. Timezones are resolved, and missing details become clear warnings or errors. Schedly then posts a preview, which expires after 24 hours.
4. A moderator with **Manage Events** clicks **Approve**, and Schedly creates an external Discord Scheduled Event and links to it. Clicking **Cancel** closes the preview.

How missing details are handled:

| Missing detail | What happens |
| --- | --- |
| Title or start time | Schedly explains that it can't schedule the event. |
| Timezone | Uses the `timezone` option, or UTC, and shows a warning. |
| End time | Assumes the event lasts 1 hour and shows a warning. |
| Location | Uses the event link as the location. |

Duplicates are blocked by link: tracking parameters are stripped, so a link is caught even with `utm_*` added. If the event matches an existing one by title and start time, the preview shows a warning.

## Prerequisites

- Node.js 22.18 or later (the register script relies on Node's built-in TypeScript support)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free plan is enough)
- A [Discord application](https://discord.com/developers/applications)
- A [Gemini API key](https://aistudio.google.com/apikey)

## Setup

### 1. Install

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in the values below
```

### 2. Create the Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), click **New Application**.
2. Under **General Information**, copy the **Application ID** into `DISCORD_APPLICATION_ID` and the **Public Key** into `DISCORD_PUBLIC_KEY`.
3. Under **Bot**, click **Reset Token** and copy the token into `DISCORD_BOT_TOKEN`.
4. Invite the bot with the `bot` and `applications.commands` scopes and the **Create Events** and **Manage Events** permissions:

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=17600775979008
   ```

5. Optional: set `DISCORD_GUILD_ID` to your test server's ID. Commands registered to a single server update instantly.

### 3. Gemini

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`. To use a different model, change `GEMINI_MODEL` in `wrangler.jsonc`.

> On the Gemini free tier, Google may use prompts and responses to improve its products. Schedly only sends the contents of public event pages.

### 4. Cloudflare D1

```sh
npx wrangler login
npx wrangler d1 create schedly        # copy the printed database_id into wrangler.jsonc
npm run db:migrate:local              # local database for `npm run dev`
```

## Development

```sh
npm run dev          # local Worker at http://localhost:8787 (reads .dev.vars)
npm test             # run all tests (in the Workers runtime via @cloudflare/vitest-plugin)
npm run typecheck    # strict TypeScript check
npm run register     # register slash commands with Discord (reads .dev.vars)
```

Discord has to reach your machine to send interactions to `npm run dev`. Expose it with a tunnel, for example `cloudflared tunnel --url http://localhost:8787`. Then set the app's **Interactions Endpoint URL** to `https://<tunnel-host>/interactions`.

## Deployment

```sh
# 1. Create the remote database schema
npm run db:migrate:remote

# 2. Store secrets (each prompts for its value; nothing is committed)
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY

# 3. Deploy
npm run deploy

# 4. Register slash commands (globally, unless DISCORD_GUILD_ID is set)
npm run register
```

Finally, set the **Interactions Endpoint URL** in the Developer Portal to `https://schedly.<your-subdomain>.workers.dev/interactions`. Discord sends a signed PING to verify the URL, and Schedly answers it automatically.

## Security

- Every request is checked against Discord's Ed25519 signature. Unsigned or invalid requests get a `401`.
- Secrets live only in Wrangler secrets or in a local `.dev.vars` file, which is gitignored.
- Fetched links must be public `http(s)` URLs. Localhost, private, link-local and metadata IP ranges, `.local` and `.internal` hosts, credentials in the URL and custom ports are all rejected, and every redirect is checked again. Fetches time out after 8 seconds and are capped at 1 MB.
- Page content is treated as untrusted. The model is told to ignore any instructions in it, and every field it returns is validated and length-limited before use.
- Bot messages never ping anyone (`allowed_mentions: { parse: [] }`).
- Approval is atomic, so a double-click or two moderators clicking at once can't create two events.

## Free-tier notes

Each piece runs within its free tier: Workers handles interactions, D1 handles storage and Gemini's free tier handles extraction. Discord requires a reply within 3 seconds, so Schedly answers `/schedule` immediately and does the page fetch and AI call in the background with `ctx.waitUntil`. Slow pages or AI responses can't cause a timeout this way. Check each provider's current limits if you expect heavy use.

## Project structure

```
src/
  index.ts          Worker entry: routing, signature verification
  router.ts         Dispatch by interaction type, command, and button
  commands/         Slash command definitions and handlers
  components/       Approve/Cancel button handling
  discord/          Discord types, REST client, signatures, permissions
  extraction/       Page fetching, HTML reduction, Gemini client, validation
  events/           D1 repository, URL normalization, preview messages
  lib/              Errors, URL safety, timezone math
migrations/         D1 schema
scripts/            Slash command registration
test/               Vitest tests, run inside the Workers runtime
```
