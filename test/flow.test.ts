// End-to-end: /schedule → preview → Approve/Cancel, with Discord, Gemini, and the event page mocked.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { InteractionResponseType, InteractionType, MessageFlags } from "../src/discord/types.ts";
import { EventRepository } from "../src/events/repository.ts";
import eventPage from "./fixtures/event-page.html?raw";
import {
  createSigner,
  geminiResponse,
  html,
  jsonResponse,
  member,
  mockFetch,
  sendInteraction,
  type RecordedRequest,
  type Signer,
} from "./helpers.ts";

const GUILD = "900000000000000001";
const DISCORD = "https://discord.com/api/v10";

const extraction = {
  is_event: true,
  title: "Intro to Rust Workshop",
  description: "A hands-on beginner workshop.",
  start_local: "2099-03-05T18:00",
  end_local: "2099-03-05T19:30",
  utc_offset: "+08:00",
  timezone: null,
  location: "Zoom",
  is_online: true,
};

let signer: Signer;
beforeEach(async () => {
  signer = await createSigner();
});

/** Mocks the outside world; `scheduledEvent` controls Discord's create-event response. */
function mockWorld(scheduledEvent: () => Response = () => jsonResponse({ id: "777000000000000001" })) {
  return mockFetch(
    (req) => (req.url.startsWith("https://events.example/") ? html(eventPage) : undefined),
    (req) => (req.url.includes("generativelanguage.googleapis.com") ? geminiResponse(extraction) : undefined),
    (req) => (req.url === `${DISCORD}/guilds/${GUILD}/scheduled-events` ? scheduledEvent() : undefined),
    (req) => (req.url.startsWith(`${DISCORD}/webhooks/`) ? jsonResponse({ id: "msg" }) : undefined),
  );
}

function schedule(url: string, options: { name: string; type: number; value: string }[] = []) {
  return sendInteraction(signer, {
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: GUILD,
    channel_id: "c1",
    member: member("111"),
    data: { name: "schedule", options: [{ name: "url", type: 3, value: url }, ...options] },
  });
}

function press(customId: string, who = member("222")) {
  return sendInteraction(signer, {
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: GUILD,
    member: who,
    data: { custom_id: customId, component_type: 2 },
  });
}

type Body = { type: number; data?: { content?: string; flags?: number } };
const webhookEdits = (calls: RecordedRequest[]) =>
  calls.filter((c) => c.method === "PATCH" && c.url.includes("/messages/@original"));

async function createPreview(url: string) {
  const calls = mockWorld();
  const res = (await (await schedule(url)).json()) as Body;
  expect(res.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
  const edit = webhookEdits(calls)[0]!.body as {
    content: string;
    embeds: { title: string; fields: { name: string; value: string }[] }[];
    components: { components: { custom_id: string }[] }[];
    allowed_mentions: { parse: string[] };
  };
  const [approve, cancel] = edit.components[0]!.components.map((c) => c.custom_id) as [string, string];
  return { edit, approve, cancel, pendingId: approve.split(":")[1]! };
}

describe("/schedule flow", () => {
  it("builds a preview with Approve/Cancel buttons and stores it", async () => {
    const { edit, approve, cancel, pendingId } = await createPreview("https://events.example/rust-1");

    expect(edit.embeds[0]!.title).toBe("Intro to Rust Workshop");
    expect(edit.embeds[0]!.fields[0]!.value).toContain(`<t:${Date.parse("2099-03-05T10:00:00Z") / 1000}:F>`);
    expect(edit.allowed_mentions).toEqual({ parse: [] });
    expect(approve).toMatch(/^approve:/);
    expect(cancel).toBe(`cancel:${pendingId}`);

    const stored = await new EventRepository(env.DB).getPending(pendingId);
    expect(stored).toMatchObject({ status: "pending", guildId: GUILD, startTime: "2099-03-05T10:00:00.000Z" });
  });

  it("approves: creates the Discord event, records it, and blocks duplicates", async () => {
    const url = "https://events.example/rust-2";
    const { approve, pendingId } = await createPreview(url);

    const calls = mockWorld();
    const res = (await (await press(approve)).json()) as Body;
    expect(res.type).toBe(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);

    const create = calls.find((c) => c.url.endsWith("/scheduled-events"))!;
    expect(create.headers.get("authorization")).toBe(`Bot ${env.DISCORD_BOT_TOKEN}`);
    expect(create.body).toMatchObject({
      name: "Intro to Rust Workshop",
      scheduled_start_time: "2099-03-05T10:00:00.000Z",
      scheduled_end_time: "2099-03-05T11:30:00.000Z",
      entity_type: 3,
      privacy_level: 2,
      entity_metadata: { location: "Zoom" },
    });
    expect((create.body as { description: string }).description).toContain(url);
    expect(JSON.stringify(webhookEdits(calls)[0]!.body)).toContain(`https://discord.com/events/${GUILD}/777000000000000001`);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("approved");

    // Same link again (with tracking params) → rejected before any AI call.
    const again = mockWorld();
    const dup = (await (await schedule(`${url}?utm_source=discord`)).json()) as Body;
    expect(dup.data?.content).toMatch(/already scheduled/);
    expect(dup.data?.flags! & MessageFlags.EPHEMERAL).toBeTruthy();
    expect(again).toHaveLength(0);
  });

  it("only lets one click win when Approve is pressed twice", async () => {
    const { approve } = await createPreview("https://events.example/rust-3");
    const calls = mockWorld();
    await press(approve);
    const second = (await (await press(approve)).json()) as Body;
    expect(second.data?.content).toMatch(/already been handled/);
    expect(calls.filter((c) => c.url.endsWith("/scheduled-events"))).toHaveLength(1);
  });

  it("cancels a preview", async () => {
    const { cancel, pendingId } = await createPreview("https://events.example/rust-4");
    const res = (await (await press(cancel)).json()) as { type: number; data: { content: string; components: unknown[] } };
    expect(res.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(res.data.content).toMatch(/Cancelled by/);
    expect(res.data.components).toEqual([]);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("cancelled");
  });

  it("refuses button presses from members without Manage Events", async () => {
    const { approve, pendingId } = await createPreview("https://events.example/rust-5");
    const res = (await (await press(approve, member("333", "0"))).json()) as Body;
    expect(res.data?.content).toMatch(/Manage Events/);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("pending");
  });

  it("explains missing bot permissions and releases the preview for retry", async () => {
    const { approve, pendingId } = await createPreview("https://events.example/rust-6");
    const calls = mockWorld(() => jsonResponse({ code: 50013, message: "Missing Permissions" }, 403));
    await press(approve);

    const followup = calls.find((c) => c.method === "POST" && /\/webhooks\/\d+\/tok$/.test(c.url))!;
    expect(followup.body).toMatchObject({ flags: MessageFlags.EPHEMERAL });
    expect((followup.body as { content: string }).content).toMatch(/permission to create events/);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("pending");
  });

  it("rejects a second /schedule while a preview is pending", async () => {
    await createPreview("https://events.example/rust-7");
    mockWorld();
    const res = (await (await schedule("https://events.example/rust-7")).json()) as Body;
    expect(res.data?.content).toMatch(/already waiting for approval/);
  });

  it("validates input immediately and privately", async () => {
    const calls = mockWorld();
    const badUrl = (await (await schedule("http://localhost/admin")).json()) as Body;
    expect(badUrl.data?.content).toMatch(/private or local address/);
    expect(badUrl.data?.flags! & MessageFlags.EPHEMERAL).toBeTruthy();

    const badTz = (await (
      await schedule("https://events.example/x", [{ name: "timezone", type: 3, value: "Moon/Base" }])
    ).json()) as Body;
    expect(badTz.data?.content).toMatch(/isn't a recognized timezone/);
    expect(calls).toHaveLength(0);
  });

  it("reports unreadable pages by editing the deferred reply", async () => {
    const calls = mockFetch(
      (req) => (req.url.startsWith("https://events.example/") ? html("gone", 404) : undefined),
      (req) => (req.url.startsWith(`${DISCORD}/webhooks/`) ? jsonResponse({}) : undefined),
    );
    await schedule("https://events.example/missing");
    expect((webhookEdits(calls)[0]!.body as { content: string }).content).toMatch(/doesn't exist \(404\)/);
  });
});
