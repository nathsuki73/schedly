// End-to-end: /schedule (image) → preview → pick / edit / confirm / cancel,
// with Discord's API, Discord's CDN, and Gemini mocked.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { InteractionResponseType, InteractionType, MessageFlags, type Attachment } from "../src/discord/types.ts";
import { EventRepository } from "../src/events/repository.ts";
import type { RawEvent } from "../src/extraction/gemini.ts";
import {
  createSigner,
  geminiResponse,
  IMAGE_BYTES,
  image,
  jsonResponse,
  makeAttachment,
  makeRawEvent,
  member,
  mockFetch,
  sendInteraction,
  type RecordedRequest,
  type Signer,
} from "./helpers.ts";

const GUILD = "900000000000000001";
const DISCORD = "https://discord.com/api/v10";
const CDN = "https://cdn.discordapp.com/attachments/";

let signer: Signer;
/** Discord event IDs must be unique across the file (D1 state persists between tests). */
let eventIds = 0;
beforeEach(async () => {
  signer = await createSigner();
});

/** Unique image bytes per test so the "same image already pending" guard doesn't interfere. */
function uniquePng(): Uint8Array {
  const bytes = new Uint8Array(IMAGE_BYTES.png.length + 16);
  bytes.set(IMAGE_BYTES.png);
  crypto.getRandomValues(bytes.subarray(IMAGE_BYTES.png.length));
  return bytes;
}

interface World {
  events?: Partial<RawEvent>[] | null;
  imageBytes?: Uint8Array;
  createEvent?: () => Response;
}

/** Mocks the outside world and records every outgoing request. */
function mockWorld({ events = [{}], imageBytes = uniquePng(), createEvent }: World = {}) {

  return mockFetch(
    (req) => (req.url.startsWith(CDN) ? image(imageBytes) : undefined),
    (req) =>
      req.url.includes("generativelanguage.googleapis.com")
        ? geminiResponse(
            events === null
              ? { contains_event: false, reason: "a landscape photo", events: [] }
              : { contains_event: true, reason: null, events: events.map((e) => makeRawEvent(e)) },
          )
        : undefined,
    (req) =>
      req.url === `${DISCORD}/guilds/${GUILD}/scheduled-events`
        ? (createEvent?.() ?? jsonResponse({ id: String(700000000000000000n + BigInt(++eventIds)) }))
        : undefined,
    (req) => (req.url.startsWith(`${DISCORD}/webhooks/`) ? jsonResponse({ id: "msg" }) : undefined),
  );
}

function schedule(attachment: Attachment = makeAttachment(), timezone?: string) {
  return sendInteraction(signer, {
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: GUILD,
    channel_id: "c1",
    member: member("111"),
    data: {
      name: "schedule",
      options: [
        { name: "image", type: 11, value: attachment.id },
        ...(timezone ? [{ name: "timezone", type: 3, value: timezone }] : []),
      ],
      resolved: { attachments: { [attachment.id]: attachment } },
    },
  });
}

function component(customId: string, values?: string[], who = member("111")) {
  return sendInteraction(signer, {
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: GUILD,
    member: who,
    data: { custom_id: customId, component_type: values ? 3 : 2, ...(values ? { values } : {}) },
  });
}

function submitEdit(pendingId: string, fields: Record<string, string>) {
  return sendInteraction(signer, {
    type: InteractionType.MODAL_SUBMIT,
    guild_id: GUILD,
    member: member("111"),
    data: {
      custom_id: `editform:${pendingId}`,
      components: Object.entries(fields).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })),
    },
  });
}

interface Preview {
  content: string;
  embeds: { title: string; fields: { name: string; value: string }[] }[];
  components: { components: { custom_id?: string; disabled?: boolean; type: number; options?: { label: string }[] }[] }[];
}
type Body = { type: number; data?: Preview & { flags?: number } };

const lastEdit = (calls: RecordedRequest[]) =>
  calls.filter((c) => c.method === "PATCH" && c.url.includes("/messages/@original")).at(-1)?.body as Preview;
const customIds = (p: Preview) => p.components.flatMap((r) => r.components.map((c) => c.custom_id ?? ""));
const pendingIdOf = (p: Preview) => customIds(p)[0]!.split(":")[1]!;
const field = (p: Preview, name: string) => p.embeds[0]!.fields.find((f) => f.name.includes(name))?.value;

async function preview(world: World = {}, attachment?: Attachment, timezone?: string) {
  const calls = mockWorld(world);
  const res = (await (await schedule(attachment, timezone)).json()) as Body;
  expect(res.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
  expect(res.data?.flags).toBe(MessageFlags.EPHEMERAL);
  const message = lastEdit(calls);
  return { calls, message, pendingId: message.components?.length ? pendingIdOf(message) : "" };
}

describe("/schedule with an image", () => {
  it("builds a review preview with Confirm, Edit, and Cancel", async () => {
    const { message, pendingId } = await preview();

    expect(message.embeds[0]!.title).toBe("Intro to Rust Workshop");
    expect(field(message, "Starts")).toContain(`<t:${Date.parse("2099-03-05T10:00:00Z") / 1000}:F>`);
    expect(customIds(message)).toEqual([`confirm:${pendingId}`, `edit:${pendingId}`, `cancel:${pendingId}`]);
    expect(message.components[0]!.components[0]!.disabled).toBe(false);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("pending");
  });

  it("confirms: creates the Discord event and reports its link", async () => {
    const { pendingId } = await preview();
    const calls = mockWorld();
    const res = (await (await component(`confirm:${pendingId}`)).json()) as Body;
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
    expect((create.body as { description: string }).description).toMatch(/Organized by Rust PH[\s\S]*Register: https:\/\/example.com\/register/);
    expect(lastEdit(calls).content).toMatch(new RegExp(`https://discord\\.com/events/${GUILD}/7\\d{17}$`));
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("approved");
  });

  it("prevents duplicates: the same event from another screenshot is rejected before preview", async () => {
    const title = "Duplicate Check Summit";
    const { pendingId } = await preview({ events: [{ title }] });
    mockWorld();
    await component(`confirm:${pendingId}`);

    const { message } = await preview({ events: [{ title: `  duplicate   check summit ` }] });
    expect(message.content).toMatch(/This event is already scheduled:\nhttps:\/\/discord.com\/events\//);
    expect(message.components ?? []).toEqual([]);
  });

  it("prevents duplicate submissions of the same image while a preview is open", async () => {
    const bytes = uniquePng();
    await preview({ imageBytes: bytes, events: [{ title: "Same Image Expo" }] });
    const { message } = await preview({ imageBytes: bytes, events: [{ title: "Same Image Expo" }] });
    expect(message.content).toMatch(/already has a preview waiting/);
  });

  it("only lets one click win when Confirm is pressed twice", async () => {
    const { pendingId } = await preview({ events: [{ title: "Double Click Day" }] });
    const calls = mockWorld();
    await component(`confirm:${pendingId}`);
    const second = (await (await component(`confirm:${pendingId}`)).json()) as Body;
    expect(second.data?.content).toMatch(/already been handled/);
    expect(calls.filter((c) => c.url.endsWith("/scheduled-events"))).toHaveLength(1);
  });

  it("asks for missing dates and ambiguous timezones instead of guessing, then accepts edits", async () => {
    const { message, pendingId } = await preview({
      events: [{ title: "Mystery Meetup", start_time: null, timezone: null, timezone_text: "PST", timezone_ambiguous: true }],
    });
    expect(message.content).toMatch(/Some details are missing/);
    expect(field(message, "Needs your input")).toBe("• Start time\n• Timezone");
    expect(field(message, "Please check")).toMatch(/“PST”, which could mean more than one timezone/);
    expect(message.components[0]!.components[0]!.disabled).toBe(true); // Confirm disabled

    // Confirm is rejected server-side too (it just re-renders the preview).
    mockWorld();
    const confirm = (await (await component(`confirm:${pendingId}`)).json()) as Body;
    expect(confirm.type).toBe(InteractionResponseType.UPDATE_MESSAGE);

    // Edit Details opens a prefilled modal.
    const modal = (await (await component(`edit:${pendingId}`)).json()) as {
      type: number;
      data: { custom_id: string; components: { components: [{ custom_id: string; value?: string }] }[] };
    };
    expect(modal.type).toBe(InteractionResponseType.MODAL);
    expect(modal.data.custom_id).toBe(`editform:${pendingId}`);
    expect(modal.data.components.map((r) => r.components[0].custom_id)).toEqual(["title", "start", "end", "timezone", "location"]);
    expect(modal.data.components[0]!.components[0].value).toBe("Mystery Meetup");

    // Invalid submission changes nothing.
    const bad = (await (
      await submitEdit(pendingId, { title: "Mystery Meetup", start: "2099-03-05 18:00", end: "", timezone: "PST", location: "Zoom" })
    ).json()) as Body;
    expect(bad.data?.content).toMatch(/Nothing was changed[\s\S]*“PST” is ambiguous/);

    // Valid submission updates the preview and enables Confirm.
    const good = (await (
      await submitEdit(pendingId, { title: "Mystery Meetup", start: "2099-03-05 18:00", end: "20:00", timezone: "PHT", location: "Zoom" })
    ).json()) as Body;
    expect(good.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(good.data?.components[0]!.components[0]!.disabled).toBe(false);
    expect(field(good.data!, "When")).toBe("2099-03-05 18:00 – 20:00 (Asia/Manila)");

    const calls = mockWorld();
    await component(`confirm:${pendingId}`);
    expect(calls.find((c) => c.url.endsWith("/scheduled-events"))?.body).toMatchObject({
      name: "Mystery Meetup",
      scheduled_start_time: "2099-03-05T10:00:00.000Z",
      scheduled_end_time: "2099-03-05T12:00:00.000Z",
    });
  });

  it("uses the timezone option when the poster has none", async () => {
    const { message } = await preview({ events: [{ title: "Option TZ", timezone: null, timezone_text: null }] }, undefined, "UTC+8");
    expect(field(message, "When")).toContain("UTC+08:00");
    expect(field(message, "Please check")).toMatch(/No timezone on the image; using UTC\+08:00/);
  });

  it("lets the user pick one event from a multi-event poster", async () => {
    const { message, pendingId } = await preview({
      events: [
        { title: "Series Part 1", start_date: "2099-05-01" },
        { title: "Series Part 2", start_date: "2099-05-08" },
      ],
    });
    expect(message.content).toMatch(/found \*\*2 events\*\*/);
    const select = message.components[0]!.components[0]!;
    expect(select.type).toBe(3);
    expect(select.options!.map((o) => o.label)).toEqual(["1. Series Part 1", "2. Series Part 2"]);

    mockWorld();
    const picked = (await (await component(`pick:${pendingId}`, ["1"])).json()) as Body;
    expect(picked.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(picked.data?.embeds[0]!.title).toBe("Series Part 2");
    expect(customIds(picked.data!)).toContain(`confirm:${pendingId}`);
  });

  it("cancels a preview", async () => {
    const { pendingId } = await preview({ events: [{ title: "Cancel Me" }] });
    mockWorld();
    const res = (await (await component(`cancel:${pendingId}`)).json()) as Body;
    expect(res.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(res.data?.content).toMatch(/Cancelled/);
    expect(res.data?.components).toEqual([]);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("cancelled");
  });

  it("refuses actions from members without Manage Events", async () => {
    const { pendingId } = await preview({ events: [{ title: "Perms" }] });
    const res = (await (await component(`confirm:${pendingId}`, undefined, member("333", "0"))).json()) as Body;
    expect(res.data?.content).toMatch(/Manage Events/);
  });

  it("explains missing bot permissions and keeps the preview open for retry", async () => {
    const { pendingId } = await preview({ events: [{ title: "No Perms Bot" }] });
    const calls = mockWorld({ createEvent: () => jsonResponse({ code: 50013, message: "Missing Permissions" }, 403) });
    await component(`confirm:${pendingId}`);

    const followup = calls.find((c) => c.method === "POST" && /\/webhooks\/\d+\/tok$/.test(c.url))!;
    expect(followup.body).toMatchObject({ flags: MessageFlags.EPHEMERAL });
    expect((followup.body as { content: string }).content).toMatch(/permission to create events/);
    expect((await new EventRepository(env.DB).getPending(pendingId))?.status).toBe("pending");
  });

  it("rejects images without event information", async () => {
    const { message } = await preview({ events: null });
    expect(message.content).toMatch(/couldn't find any event details in that image \(a landscape photo\)/);
  });

  it("rejects files that aren't really images after download", async () => {
    const { message, calls } = await preview({ imageBytes: new TextEncoder().encode("MZ fake exe") });
    expect(message.content).toMatch(/isn't a valid image/);
    expect(calls.some((c) => c.url.includes("generativelanguage"))).toBe(false);
  });

  it("validates the attachment and timezone immediately and privately", async () => {
    const calls = mockWorld();
    const gif = (await (await schedule(makeAttachment({ filename: "a.gif", content_type: "image/gif" }))).json()) as Body;
    expect(gif.data?.content).toMatch(/PNG, JPG, or WebP/);
    expect(gif.data?.flags! & MessageFlags.EPHEMERAL).toBeTruthy();

    const tz = (await (await schedule(makeAttachment(), "PST")).json()) as Body;
    expect(tz.data?.content).toMatch(/`PST` is ambiguous/);
    expect(calls).toHaveLength(0);
  });
});
