import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EventRepository, PENDING_TTL_MS, type NewPendingEvent } from "../../src/events/repository.ts";
import { makeDraft } from "../helpers.ts";

const repo = () => new EventRepository(env.DB);

function newPending(overrides: Partial<NewPendingEvent> = {}): NewPendingEvent {
  const draft = makeDraft();
  return {
    guildId: "g1",
    channelId: "c1",
    requestedBy: "u1",
    imageHash: crypto.randomUUID(),
    draft,
    candidates: [draft],
    ...overrides,
  };
}

describe("EventRepository", () => {
  it("round-trips pending events including drafts", async () => {
    const created = await repo().createPending(newPending(), 1000);
    expect(created.expiresAt).toBe(1000 + PENDING_TTL_MS);
    expect(await repo().getPending(created.id)).toEqual(created);
    expect(await repo().getPending("missing")).toBeNull();

    const picker = await repo().createPending(newPending({ draft: null, candidates: [makeDraft(), makeDraft({ title: "B" })] }));
    expect((await repo().getPending(picker.id))?.draft).toBeNull();
    expect((await repo().getPending(picker.id))?.candidates).toHaveLength(2);
  });

  it("finds active previews for the same image only while unexpired", async () => {
    const p = await repo().createPending(newPending(), 1000);
    expect((await repo().findActivePendingByImage("g1", p.imageHash, 2000))?.id).toBe(p.id);
    expect(await repo().findActivePendingByImage("g2", p.imageHash, 2000)).toBeNull();
    expect(await repo().findActivePendingByImage("g1", p.imageHash, 1000 + PENDING_TTL_MS + 1)).toBeNull();
  });

  it("updates drafts only while pending", async () => {
    const p = await repo().createPending(newPending());
    expect(await repo().updateDraft(p.id, makeDraft({ title: "Edited" }))).toBe(true);
    expect((await repo().getPending(p.id))?.draft?.title).toBe("Edited");

    await repo().transition(p.id, "pending", "cancelled");
    expect(await repo().updateDraft(p.id, makeDraft({ title: "Too late" }))).toBe(false);
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

  it("refuses to confirm expired previews", async () => {
    const p = await repo().createPending(newPending(), 1000);
    expect(await repo().transition(p.id, "pending", "approving", 1000 + PENDING_TTL_MS + 1)).toBe(false);
  });

  it("records each event once per guild", async () => {
    const event = {
      id: "evt1",
      guildId: "g1",
      dedupeKey: "rust workshop|2030-03-05T10:00:00.000Z",
      title: "Rust Workshop",
      startTime: "2030-03-05T10:00:00.000Z",
      approvedBy: "u1",
      pendingId: null,
    };
    expect(await repo().recordEvent(event)).toBe(true);
    expect(await repo().recordEvent({ ...event, id: "evt2" })).toBe(false);
    expect((await repo().findEventByKey("g1", event.dedupeKey))?.id).toBe("evt1");
    expect(await repo().findEventByKey("g2", event.dedupeKey)).toBeNull();
  });

  it("purges long-expired previews", async () => {
    const p = await repo().createPending(newPending(), 0);
    await repo().purgeExpired(2 * PENDING_TTL_MS + 1);
    expect(await repo().getPending(p.id)).toBeNull();
  });
});
