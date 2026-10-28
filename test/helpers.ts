import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import type { Attachment, Interaction } from "../src/discord/types.ts";
import type { EventDraft } from "../src/extraction/draft.ts";
import type { RawEvent } from "../src/extraction/gemini.ts";
import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";

/** Request typed as an incoming Worker request (with `cf` properties). */
export const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Signer {
  publicKeyHex: string;
  sign(timestamp: string, body: string): Promise<string>;
}

export async function createSigner(): Promise<Signer> {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  return {
    publicKeyHex: bytesToHex(raw),
    async sign(timestamp, body) {
      const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
      return bytesToHex(sig);
    },
  };
}

/** Snowflake for "now" so latency calculations stay realistic. */
export function snowflakeNow(): string {
  return ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides };
}

/** Sends a correctly signed interaction to the Worker and waits for background work. */
export async function sendInteraction(
  signer: Signer,
  interaction: Partial<Interaction>,
  envOverrides: Partial<Env> = {},
): Promise<Response> {
  const body = JSON.stringify({ id: snowflakeNow(), application_id: env.DISCORD_APPLICATION_ID, token: "tok", ...interaction });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const request = new IncomingRequest("https://schedly.test/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": await signer.sign(timestamp, body),
      "x-signature-timestamp": timestamp,
    },
    body,
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv({ DISCORD_PUBLIC_KEY: signer.publicKeyHex, ...envOverrides }), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Headers;
}

type Route = (req: Request) => Response | Promise<Response> | undefined;

/**
 * Replaces global fetch with a router over `routes` (first match wins) and records every call.
 * Unmatched requests fail loudly so tests never hit the real network.
 */
export function mockFetch(...routes: Route[]): RecordedRequest[] {
  const calls: RecordedRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const text = req.body ? await req.clone().text() : "";
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* keep raw text */
    }
    calls.push({ method: req.method, url: req.url, body, headers: req.headers });
    for (const route of routes) {
      const res = await route(req);
      if (res) return res;
    }
    throw new Error(`Unmocked fetch: ${req.method} ${req.url}`);
  });
  return calls;
}

export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A Gemini generateContent response wrapping `extraction` as the model's JSON answer. */
export function geminiResponse(extraction: Record<string, unknown>): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] }, finishReason: "STOP" }],
  });
}

export const MANAGE_EVENTS_PERMS = (1n << 33n).toString();

export function member(id = "111", permissions = MANAGE_EVENTS_PERMS) {
  return { user: { id, username: `user${id}` }, permissions };
}

/** A complete, valid draft (Asia/Manila, far future) for tests to tweak. */
export function makeDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: "Intro to Rust Workshop",
    description: "A hands-on beginner workshop.",
    startDate: "2099-03-05",
    startTime: "18:00",
    endDate: null,
    endTime: "19:30",
    timeZone: "Asia/Manila",
    timeZoneText: "PHT",
    location: "Zoom",
    isOnline: true,
    registrationUrl: "https://example.com/register",
    organizer: "Rust PH",
    notes: [],
    ...overrides,
  };
}

/** A model-side event with every field present, for building Gemini responses. */
export function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    title: "Intro to Rust Workshop",
    description: "A hands-on beginner workshop.",
    start_date: "2099-03-05",
    start_time: "18:00",
    end_date: null,
    end_time: "19:30",
    utc_offset: null,
    timezone: "Asia/Manila",
    timezone_text: "PHT",
    timezone_ambiguous: false,
    location: "Zoom",
    is_online: true,
    registration_url: "example.com/register",
    organizer: "Rust PH",
    ambiguities: [],
    ...overrides,
  };
}

/** Minimal byte payloads with real file signatures. */
export const IMAGE_BYTES = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]),
  webp: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]),
  gif: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0]),
};

export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att1",
    filename: "poster.png",
    size: IMAGE_BYTES.png.length,
    url: "https://cdn.discordapp.com/attachments/1/2/poster.png?ex=abc",
    content_type: "image/png",
    ...overrides,
  };
}

export const image = (bytes: Uint8Array, type = "image/png") =>
  new Response(bytes, { headers: { "content-type": type } });
