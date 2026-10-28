import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EventRepository, PENDING_TTL_MS, type NewPendingEvent } from "../../src/events/repository.ts";

const repo = () => new EventRepository(env.DB);

function newPending(overrides: Partial<NewPendingEvent> = {}): NewPendingEvent {
  return {
    guildId: "g1",
    channelId: "c1",
    requestedBy: "u1",
    sourceUrl: "https://example.com/e",
    urlHash: crypto.randomUUID(),
    title: "Workshop",
    description: null,
    startTime: "2030-03-05T10:00:00.000Z",
    endTime: "2030-03-05T11:00:00.000Z",
    location: "Zoom",
    warnings: ["No end time found; assumed 1 hour."],
    ...overrides,
  };
}

describe("EventRepository", () => {
  it("round-trips pending events", async () => {
    const created = await repo().createPending(newPending(), 1000);
    expect(created.expiresAt).toBe(1000 + PENDING_TTL_MS);
    expect(await repo().getPending(created.id)).toEqual(created);
    expect(await repo().getPending("missing")).toBeNull();
  });

  it("finds active previews for the same link only while unexpired", async () => {
    const p = await repo().createPending(newPending(), 1000);
    expect((await repo().findActivePending("g1", p.urlHash, 2000))?.id).toBe(p.id);
    expect(await repo().findActivePending("g2", p.urlHash, 2000)).toBeNull();
    expect(await repo().findActivePending("g1", p.urlHash, 1000 + PENDING_TTL_MS + 1)).toBeNull();
  });

  it("transitions status atomically (only one winner)", async () => {
    const p = await repo().createPending(newPending());
    const results = await Promise.all([
      repo().transition(p.id, "pending", "approving"),
      repo().transition(p.id, "pending", "approving"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repo().getPending(p.id))?.status).toBe("approving");
  });

  it("refuses to approve expired previews", async () => {
    const p = await repo().createPending(newPending(), 1000);
    expect(await repo().transition(p.id, "pending", "approving", 1000 + PENDING_TTL_MS + 1)).toBe(false);
  });

  it("records events once per guild and link, and finds similar events", async () => {
    const event = {
      id: "evt1",
      guildId: "g1",
      urlHash: "hash-a",
      sourceUrl: "https://example.com/a",
      title: "Rust Workshop",
      startTime: "2030-03-05T10:00:00.000Z",
      approvedBy: "u1",
      pendingId: null,
    };
    expect(await repo().recordEvent(event)).toBe(true);
    expect(await repo().recordEvent({ ...event, id: "evt2" })).toBe(false);
    expect((await repo().findEventByHash("g1", "hash-a"))?.id).toBe("evt1");
    expect(await repo().findEventByHash("g2", "hash-a")).toBeNull();
    expect((await repo().findSimilarEvent("g1", "rust workshop", event.startTime))?.id).toBe("evt1");
    expect(await repo().findSimilarEvent("g1", "rust workshop", "2030-03-06T10:00:00.000Z")).toBeNull();
  });

  it("purges long-expired previews", async () => {
    const p = await repo().createPending(newPending(), 0);
    await repo().purgeExpired(2 * PENDING_TTL_MS + 1);
    expect(await repo().getPending(p.id)).toBeNull();
  });
});
