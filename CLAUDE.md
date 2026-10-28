# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Schedly is a Discord bot that runs on Cloudflare Workers using Discord's HTTP Interactions (not the gateway). `/schedule image:<attachment>` sends an event poster or screenshot to Gemini and shows the user an ephemeral preview. The preview has **Confirm & Create Event**, **Edit Details** (a pop-up form in Discord) and **Cancel**, plus a dropdown when the image contains several events. Confirming creates a native Discord Scheduled Event. Data lives in Cloudflare D1. The README covers setup, usage and deployment.

## Commands

```sh
npm test                                     # all tests (Vitest inside workerd via @cloudflare/vitest-plugin)
npx vitest run test/flow.test.ts             # single file
npx vitest run -t "multi-event"              # single test by name
npm run typecheck                            # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run dev                                  # wrangler dev on :8787, reads .dev.vars
npx wrangler deploy --dry-run --outdir dist  # verify the bundle without deploying
npm run db:migrate:local                     # apply migrations/ to the local D1
```

Before finishing any change, run `npm run typecheck` and `npm test`.

**Never run without the user's explicit approval:** `npm run deploy` / `wrangler deploy`, `npm run db:migrate:remote`, `wrangler secret put`, `npm run register`, `git push`, or `gh repo create`. All of these act on live services.

Never stage or print `.dev.vars` or `.dev.vars.example` values. The example file is tracked, so check that it contains no real credentials before committing it.

## Architecture

**How a request flows:** `src/index.ts` verifies the Ed25519 signature, then `src/router.ts` dispatches by interaction type:

- commands go to `src/commands/`
- buttons and the dropdown go to `components/preview-actions.ts` (`handlePreviewComponent`)
- Edit-form submissions go to `handleEditSubmit`

custom_ids have the form `<action>:<pendingId>`, where the action is `confirm`, `edit`, `cancel`, `pick` or `editform` (see `Action` in `events/preview.ts`). Every action goes through the shared `load()` guard: it parses the ID, checks Manage Events, loads the preview, and checks its status and expiry.

**The 3-second rule:** Discord drops any reply that takes more than 3 seconds. Handlers do cheap checks inline (attachment metadata, timezone option, permissions, D1 lookups) and return an immediate ephemeral error if something is wrong. Slow work goes to `ctx.waitUntil(...)` after a deferred response:

- `/schedule` returns type 5 (ephemeral) and later edits `@original`.
- **Confirm** returns type 6 and later edits `@original`. Errors go to an ephemeral follow-up.
- Pick, Edit and Cancel answer synchronously with type 7 (UPDATE_MESSAGE) or 9 (MODAL).

The free plan's `waitUntil` window is about 30 seconds, and the Gemini timeout is 25 seconds.

**Extraction pipeline:**

1. `extraction/image.ts` checks the attachment. Downloads come only from `cdn.discordapp.com` / `media.discordapp.net`, are size-capped while streaming, and the format is detected from the file's first bytes.
2. `extraction/gemini.ts` sends the image inline (native `Uint8Array#toBase64`) with a `responseSchema`. It tries `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`, on 404, 429 or 5xx, all within one 25-second deadline. `parseExtraction` shape-checks the JSON.
3. `extraction/draft.ts`:
   - `toDraft` builds an `EventDraft`, which can be incomplete.
   - `resolveDraft` produces either a `ResolvedEvent` in UTC or a list of what's `missing`.
   - `applyEdits` checks what the user submitted in the Edit form.

This module is the **only gate** for model output. The rules:

- Never guess missing essentials (title, start date and time, timezone, location). List them in `missing` instead; the UI disables Confirm.
- Drafts store *wall-clock* date and time plus a zone string (an IANA name or `+08:00`). UTC is computed only in `resolveDraft` via `lib/time.ts`. Don't ask the model to do timezone math.
- `AMBIGUOUS_ZONE_ABBREVIATIONS` (PST, CST, IST, …) override the model. They are never auto-resolved, and only the user's `timezone` option or an edit can settle them.

**Preview states** (`pending_events.status`): `pending → approving → approved`, or `pending → cancelled`. `EventRepository.transition()` is a conditional `UPDATE … WHERE status = ?`, which guards against double-clicks. If creating the event fails, the preview goes back from `approving` to `pending` so it can be retried. `draft` is NULL while the user still has to pick one of several `candidates`. Previews expire after 24 hours (`PENDING_TTL_MS`).

**Duplicate detection:**

- **Open previews:** `pending_events.image_hash` (SHA-256 of the image bytes) blocks a second open preview of the same image.
- **Created events:** `events.dedupe_key` = `eventKey(title, startUtc)` (`events/dedupe.ts`), unique per guild. It's checked before showing a preview and again at confirmation.

## Conventions

- **No runtime dependencies.** Use Web APIs (`fetch`, Web Crypto, `Intl`). Note that Workers `fetch` supports only `redirect: "follow" | "manual"`.
- Import paths include the `.ts` extension. `src/commands/definitions.ts` must stay import-free because `scripts/register-commands.ts` runs it directly with Node's type stripping.
- All SQL lives in `src/events/repository.ts`, which maps snake_case rows to camelCase types. Schema changes go in a **new** numbered file in `migrations/`. Never edit a migration that has already been applied remotely (`0001` is applied in production).
- Messages meant for users are thrown as `UserFacingError`. Anything else is logged and shown as a generic message through `userMessage()`, so internal details never reach Discord.
- Every Discord message payload includes `allowed_mentions: { parse: [] }`. The helpers in `discord/responses.ts` and `discord/api.ts` add it automatically.
- Respect Discord's limits:
  - event name and location: at most 100 characters
  - description: at most 1000
  - modal: 5 text inputs, labels at most 45 characters
  - select menu: 25 options (Schedly caps images at 10 events)

## Testing

- Tests run inside workerd with a real local D1. `test/setup.ts` applies all migrations, and test-only bindings are set in `vitest.config.ts`.
- `test/helpers.ts`:
  - `createSigner()` makes a throwaway Ed25519 keypair.
  - `sendInteraction()` signs a request and sends it through the real Worker entry. It also awaits `waitUntil` work, so the effects of background work can be checked.
  - `mockFetch(...routes)` stubs global `fetch`, records every call, and throws on unmatched URLs.
  - `makeDraft()`, `makeRawEvent()`, `makeAttachment()` and `IMAGE_BYTES` build fixtures.
- In `test/flow.test.ts`, `mockWorld()` mocks the Discord CDN, Gemini and the Discord API together. D1 state persists across tests in a file, so use unique event titles, unique image bytes (`uniquePng()`) and unique Discord event IDs.
- Use dates far in the future (2099) for anything that must be "upcoming", or pass `now` explicitly.
