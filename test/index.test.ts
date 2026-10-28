import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { InteractionResponseType, InteractionType, MessageFlags } from "../src/discord/types.ts";
import worker from "../src/index.ts";
import { createSigner, IncomingRequest, sendInteraction, testEnv } from "./helpers.ts";

describe("Worker entry", () => {
  it("responds to the health check", async () => {
    const res = await worker.fetch(new IncomingRequest("https://schedly.test/"), env, createExecutionContext());
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown paths and 405 for non-POST interactions", async () => {
    const ctx = createExecutionContext();
    expect((await worker.fetch(new IncomingRequest("https://schedly.test/nope"), env, ctx)).status).toBe(404);
    expect((await worker.fetch(new IncomingRequest("https://schedly.test/interactions"), env, ctx)).status).toBe(405);
  });

  it("rejects unsigned requests with 401", async () => {
    const signer = await createSigner();
    const res = await worker.fetch(
      new IncomingRequest("https://schedly.test/interactions", { method: "POST", body: '{"type":1}' }),
      testEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex }),
      createExecutionContext(),
    );
    expect(res.status).toBe(401);
  });

  it("answers Discord's PING with PONG", async () => {
    const res = await sendInteraction(await createSigner(), { type: InteractionType.PING });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: InteractionResponseType.PONG });
  });
});

describe("/ping", () => {
  it("replies ephemerally with a pong", async () => {
    const res = await sendInteraction(await createSigner(), {
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: "ping" },
    });
    const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(body.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(body.data.content).toMatch(/Pong! Schedly is online/);
    expect(body.data.flags & MessageFlags.EPHEMERAL).toBeTruthy();
  });

  it("handles unknown commands gracefully", async () => {
    const res = await sendInteraction(await createSigner(), {
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: "nope" },
    });
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toBe("Unknown command.");
  });
});
