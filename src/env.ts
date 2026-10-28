/** Bindings available to the Worker. Secrets are set via `wrangler secret put` (or `.dev.vars` locally). */
export interface Env {
  DB: D1Database;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
}
