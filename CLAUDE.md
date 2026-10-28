# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Schedly is a Discord bot that runs on Cloudflare Workers using Discord's HTTP Interactions (not the gateway). `/schedule <url>` fetches an event page, uses Gemini to extract the event details, posts a preview with Approve and Cancel buttons, and creates a Discord Scheduled Event once a moderator approves it. Data lives in Cloudflare D1. The README covers setup and deployment.

## Commands

```sh
npm test                                     # all tests (Vitest inside workerd via @cloudflare/vitest-plugin)
npx vitest run test/flow.test.ts             # single file
npx vitest run -t "approves"                 # single test by name
npm run typecheck                            # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run dev                                  # wrangler dev on :8787, reads .dev.vars
npx wrangler deploy --dry-run --outdir dist  # verify the bundle without deploying
npm run db:migrate:local                     # apply migrations/ to the local D1
```

Before finishing any change, run `npm run typecheck` and `npm test`.

**Never run without the user's explicit approval:** `npm run deploy` / `wrangler deploy`, `npm run db:migrate:remote`, `wrangler secret put`, `npm run register`, `git push`, or `gh repo create`. All of these act on live services.

## Architecture

**How a request flows:** `src/index.ts` verifies the Ed25519 signature, then `src/router.ts` dispatches by interaction type. Commands go to `src/commands/`, and button presses (`approve:<id>` and `cancel:<id>` custom IDs) go to `src/components/approval.ts`.

**The 3-second rule:** Discord drops any reply that takes more than 3 seconds. Handlers do cheap checks inline (input validation, permissions, D1 lookups) and return an immediate ephemeral error if something is wrong. Slow work (the page fetch, the Gemini call, the Discord REST call) is passed to `ctx.waitUntil(...)` after a deferred response:

- `/schedule` returns type 5 and later edits `@original` with the preview.
- **Approve** returns type 6 and later edits `@original`. Errors go to an ephemeral follow-up.

**Extraction pipeline** (`src/extraction/extract.ts`), in order:

1. `fetch-page.ts` fetches the page with SSRF guards. Redirects are followed manually and each hop is re-checked with `lib/url-safety.ts`.
2. `html.ts` uses HTMLRewriter to pull out the title, meta tags, JSON-LD `*Event` objects and visible text.
3. `gemini.ts` calls Gemini over REST with `responseSchema`.
4. `validate.ts` normalizes the result. Model output is untrusted, and **this file is the only gate** before it reaches D1 or Discord.

The model returns *wall-clock* times plus an offset or IANA zone, and `lib/time.ts` converts them to UTC with Intl. Don't ask the model to do timezone math.

**Preview states** (`pending_events.status`): `pending → approving → approved`, or `pending → cancelled`. `EventRepository.transition()` is a conditional `UPDATE … WHERE status = ?`, which guards against double-clicks. If creating the event fails, the preview goes back from `approving` to `pending` so it can be retried. Previews expire after 24 hours (`PENDING_TTL_MS`).

**Duplicate detection:**

- `events.url_hash` is unique per guild. The hash is SHA-256 of `normalizeUrl()` output, which drops tracking parameters, the fragment and `www.`.
- The hash is checked twice: in `/schedule` before any AI call, and again at approval time.
- A match on title and start time only adds a warning to the preview.

## Conventions

- **No runtime dependencies.** Use Web APIs (`fetch`, Web Crypto, `HTMLRewriter`, `Intl`). Add dev dependencies only when they're really needed.
- Import paths include the `.ts` extension. `src/commands/definitions.ts` must stay import-free because `scripts/register-commands.ts` runs it directly with Node's type stripping.
- All SQL lives in `src/events/repository.ts`, which maps snake_case rows to camelCase types. Schema changes go in a **new** numbered file in `migrations/`. Never edit a migration that has already been applied remotely.
- Messages meant for users are thrown as `UserFacingError`. Anything else is logged and shown as a generic message through `userMessage()`, so internal details never reach Discord.
- Every Discord message payload includes `allowed_mentions: { parse: [] }`. The helpers in `discord/responses.ts` and `discord/api.ts` add it automatically.
- Respect Discord's limits: event name and location at most 100 characters, description at most 1000 (see `validate.ts` and `scheduled-event.ts`).
- Secrets come only from `env` (`wrangler secret` in production, `.dev.vars` locally). The Gemini key goes in the `x-goog-api-key` header, never in a URL.
- Workers free plan: CPU time per request is limited (network waits don't count). Keep parsing streaming and bounded (the page cap is 1 MB and the text cap is 15k characters).

## Testing

- Tests run inside workerd with a real local D1. `test/setup.ts` applies the migrations, and test-only bindings are set in `vitest.config.ts`.
- `test/helpers.ts`:
  - `createSigner()` makes a throwaway Ed25519 keypair.
  - `sendInteraction()` signs a request and sends it through the real Worker entry. It also awaits `waitUntil` work, so the effects of background work can be checked.
  - `mockFetch(...routes)` stubs global `fetch`, records every call, and throws on unmatched URLs, so tests never touch the network.
- `test/flow.test.ts` is the end-to-end suite (schedule → preview → approve or cancel, duplicates, permissions). Use unique URLs per test, because D1 state is shared within a file.
- Use dates far in the future (2099) for anything that must be "upcoming", or pass `now` explicitly.
