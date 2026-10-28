# Schedly

An AI-powered Discord bot that turns **event posters and screenshots** into native **Discord Scheduled Events**.

Upload an image with `/schedule` and Schedly reads it with Gemini. You review (and, if needed, fix) the details, then click **Confirm & Create Event**. The event appears in your server's Events tab.

- Runs on **Cloudflare Workers** (free tier) using Discord's **HTTP Interactions**, so there's no always-on gateway connection.
- Stores previews and created events in **Cloudflare D1**.
- Uses **Google Gemini** (`gemini-3.8-flash`, with automatic fallbacks) with image input and structured JSON output.
- Has **zero runtime npm dependencies**.

## Using `/schedule`

| Command | Who | What it does |
| --- | --- | --- |
| `/ping` | Everyone | Checks that the bot is online. |
| `/schedule image:<file> [timezone:<zone>]` | Members with **Manage Events** | Reads an event image and shows a private preview to confirm. |

1. Type `/schedule` and attach the poster, announcement or screenshot to the `image` option.
2. Optional: set `timezone` (for example `Asia/Manila`, `PHT` or `UTC+8`). It's only used when the image doesn't state a timezone clearly.
3. Schedly replies with a preview that **only you can see**. It has three buttons:
   - **Confirm & Create Event** creates the Discord event. It stays disabled until the title, start date and time, timezone and location are all known.
   - **Edit Details** opens a form to fix the title, start, end, timezone or location.
   - **Cancel** closes the preview without creating anything.
4. If the image announces **several events** (for example a multi-day series), pick one from the dropdown. To schedule another one, run `/schedule` again with the same image.
5. After you confirm, the preview shows a link to the new event.

**Supported images:** PNG, JPG/JPEG and WebP, up to **10 MB**.

### How Gemini extracts the event

Schedly sends the image to Gemini and asks for structured JSON with these fields for each event in the image: title, description, start date and time, end date and time, timezone, location or online platform, registration URL and organizer. Natural-language dates such as "Sat, Nov 8 · 2–4 PM" are understood.

The answer is never trusted blindly:

- **Nothing is invented.** If the title, start date or time, timezone or location is missing, the preview lists it under **Needs your input**. Confirm stays disabled until you fill it in with **Edit Details**.
- **Ambiguous timezones are flagged.** Abbreviations such as **PST** (Pacific *or* Philippine), CST, IST and BST are never resolved automatically. Schedly uses your `timezone` option if you gave one, and otherwise asks you.
- **Philippine Standard Time is recognized.** "PHT", "Philippine Standard Time" and "Manila time" all map to `Asia/Manila`. Any IANA timezone or UTC offset works.
- **Assumptions are shown, not hidden.** If there's no end time, Schedly assumes 1 hour. An end time earlier than the start is treated as the next day. If the year is missing, the next upcoming date is used. Each of these appears under **Please check**.
- **Images with no event are rejected,** such as photos, memes or unreadable images.
- Every field is validated and trimmed to Discord's limits before it's used.

### Duplicate protection

- The same image can't have two open previews at once.
- An event with the same title and start time can't be created twice in one server, even from a different screenshot. If you upload it again, Schedly links to the existing event.
- Double-clicking Confirm creates only one event.

## Required Discord permissions

| Who | Permission | Why |
| --- | --- | --- |
| The **bot** | **Create Events** and **Manage Events** | To create scheduled events. |
| The **user** | **Manage Events** | To use `/schedule` and to confirm. Admins can change who sees the command in *Server Settings → Integrations*. |

If the bot lacks permission, Schedly says so, and the preview stays open so you can press Confirm again after an admin fixes it.

Invite link (replace `<APPLICATION_ID>`):

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=17600775979008
```

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

Fill in `.dev.vars`, not `.dev.vars.example`. The example file is committed to git.

### 2. Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), click **New Application**.
2. Under **General Information**, copy the **Application ID** into `DISCORD_APPLICATION_ID` and the **Public Key** into `DISCORD_PUBLIC_KEY`.
3. Under **Bot**, click **Reset Token** and copy the token into `DISCORD_BOT_TOKEN`.
4. Invite the bot with the link above.
5. Optional: set `DISCORD_GUILD_ID` to your test server's ID. Commands registered to a single server update instantly.

### 3. Gemini

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`.

Models are set in `wrangler.jsonc`. `GEMINI_MODEL` is tried first, then each model in `GEMINI_FALLBACK_MODELS` (comma-separated). Schedly falls back when a model is retired (404), rate-limited (429) or overloaded (5xx). Google retires older models for new API keys (`gemini-2.5-flash` is one), so update these if extraction starts failing. To see which models your key can use, run `curl -H "x-goog-api-key: $GEMINI_API_KEY" https://generativelanguage.googleapis.com/v1beta/models`.

> On the Gemini free tier, Google may use prompts (including uploaded images) to improve its products. Don't use Schedly with images you can't share with Google.

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
# 1. Apply database migrations (0002 switches previews to image-based drafts and keeps created events)
npm run db:migrate:remote

# 2. Store secrets (each prompts for its value; nothing is committed)
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY

# 3. Deploy the Worker
npm run deploy

# 4. Register the updated slash commands (replaces the old `url` option with `image`)
npm run register
```

Finally, set the **Interactions Endpoint URL** in the Developer Portal to `https://schedly.<your-subdomain>.workers.dev/interactions`. Discord sends a signed PING to verify the URL, and Schedly answers it automatically.

Commands registered globally (without `DISCORD_GUILD_ID`) can take a while to show up in every server. Registering to a single server updates instantly.

## Security

- Every request is checked against Discord's Ed25519 signature. Unsigned or invalid requests get a `401`.
- Secrets live only in Wrangler secrets or in a local `.dev.vars` file, which is gitignored. The Gemini key is sent in a header, never in a URL, and is never logged.
- Images are downloaded **only from Discord's CDN** over HTTPS:
  - checked against a size cap while streaming
  - limited by a timeout
  - identified by their **file signature** (magic bytes), not by name or declared type
- Image text is treated as untrusted. The model is told to ignore any instructions in it, and every field it returns is shape-checked, validated and length-limited.
- Previews are ephemeral, and bot messages never ping anyone (`allowed_mentions: { parse: [] }`).
- Confirmation is atomic, so a double-click or two people clicking at once can't create two events.

## Free-tier notes

Discord requires a reply within 3 seconds. Schedly therefore defers its reply straight away and does the download and AI call in the background with `ctx.waitUntil`. Images are base64-encoded natively, which keeps CPU time low on the Workers free plan. Check Cloudflare's and Google's current limits if you expect heavy use.

## Project structure

```
src/
  index.ts          Worker entry: routing, signature verification
  router.ts         Dispatch by interaction type: commands, components, modal submits
  commands/         Slash command definitions and handlers (/ping, /schedule)
  components/       Preview actions: pick, edit (modal), confirm, cancel
  discord/          Discord types, REST client, signatures, permissions
  extraction/       Image download and validation, Gemini client, draft validation
  events/           D1 repository, duplicate keys, preview and modal builders
  lib/              Errors, timezone math
migrations/         D1 schema
scripts/            Slash command registration
test/               Vitest tests, run inside the Workers runtime
```
