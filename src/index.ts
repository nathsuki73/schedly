import { json } from "./discord/responses.ts";
import type { Interaction } from "./discord/types.ts";
import { verifyDiscordRequest } from "./discord/verify.ts";
import type { Env } from "./env.ts";
import { routeInteraction } from "./router.ts";

/** Discord interaction bodies are small; refuse anything larger before verifying. */
const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Schedly is running.", { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname !== "/interactions") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

    const valid = await verifyDiscordRequest(
      body,
      request.headers.get("x-signature-ed25519"),
      request.headers.get("x-signature-timestamp"),
      env.DISCORD_PUBLIC_KEY,
    );
    if (!valid) return new Response("Invalid request signature", { status: 401 });

    let interaction: Interaction;
    try {
      interaction = JSON.parse(body) as Interaction;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    return json(await routeInteraction(interaction, env, ctx));
  },
} satisfies ExportedHandler<Env>;
