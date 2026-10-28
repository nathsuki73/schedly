// Typed access to D1. All SQL lives here; callers work with camelCase domain objects.
import type { EventDraft } from "../extraction/draft.ts";

export type PendingStatus = "pending" | "approving" | "approved" | "cancelled";

export interface PendingEvent {
  id: string;
  guildId: string;
  channelId: string | null;
  requestedBy: string;
  imageHash: string;
  /** The draft under review; null while the user still has to pick one of several events. */
  draft: EventDraft | null;
  candidates: EventDraft[];
  status: PendingStatus;
  createdAt: number;
  expiresAt: number;
}

export type NewPendingEvent = Pick<PendingEvent, "guildId" | "channelId" | "requestedBy" | "imageHash" | "draft" | "candidates">;

export interface StoredEvent {
  id: string;
  guildId: string;
  dedupeKey: string;
  title: string;
  startTime: string;
  approvedBy: string;
  pendingId: string | null;
  createdAt: number;
}

/** How long a preview can wait for confirmation. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingRow {
  id: string;
  guild_id: string;
  channel_id: string | null;
  requested_by: string;
  image_hash: string;
  draft: string | null;
  candidates: string;
  status: PendingStatus;
  created_at: number;
  expires_at: number;
}

interface EventRow {
  id: string;
  guild_id: string;
  dedupe_key: string;
  title: string;
  start_time: string;
  approved_by: string;
  pending_id: string | null;
  created_at: number;
}

function toPending(row: PendingRow): PendingEvent {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    requestedBy: row.requested_by,
    imageHash: row.image_hash,
    draft: row.draft ? (JSON.parse(row.draft) as EventDraft) : null,
    candidates: JSON.parse(row.candidates) as EventDraft[],
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    guildId: row.guild_id,
    dedupeKey: row.dedupe_key,
    title: row.title,
    startTime: row.start_time,
    approvedBy: row.approved_by,
    pendingId: row.pending_id,
    createdAt: row.created_at,
  };
}

export class EventRepository {
  constructor(private readonly db: D1Database) {}

  async createPending(input: NewPendingEvent, now = Date.now()): Promise<PendingEvent> {
    const pending: PendingEvent = {
      ...input,
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
    };
    await this.db
      .prepare(
        `INSERT INTO pending_events
          (id, guild_id, channel_id, requested_by, image_hash, draft, candidates, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        pending.id,
        pending.guildId,
        pending.channelId,
        pending.requestedBy,
        pending.imageHash,
        pending.draft ? JSON.stringify(pending.draft) : null,
        JSON.stringify(pending.candidates),
        pending.status,
        pending.createdAt,
        pending.expiresAt,
      )
      .run();
    return pending;
  }

  async getPending(id: string): Promise<PendingEvent | null> {
    const row = await this.db.prepare("SELECT * FROM pending_events WHERE id = ?").bind(id).first<PendingRow>();
    return row ? toPending(row) : null;
  }

  /** A preview of the same image that is still awaiting a decision, if any. */
  async findActivePendingByImage(guildId: string, imageHash: string, now = Date.now()): Promise<PendingEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM pending_events
         WHERE guild_id = ? AND image_hash = ? AND status IN ('pending', 'approving') AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(guildId, imageHash, now)
      .first<PendingRow>();
    return row ? toPending(row) : null;
  }

  /** Replaces the draft under review. Only allowed while the preview is pending and unexpired. */
  async updateDraft(id: string, draft: EventDraft, now = Date.now()): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE pending_events SET draft = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
      .bind(JSON.stringify(draft), id, now)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Atomically moves a preview from one status to another. Returns false if the preview
   * was not in `from` (e.g. someone else already handled it). This is the double-click guard.
   * Moving out of "pending" also requires the preview to be unexpired.
   */
  async transition(id: string, from: PendingStatus, to: PendingStatus, now = Date.now()): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE pending_events SET status = ?
         WHERE id = ? AND status = ? AND (? != 'pending' OR expires_at > ?)`,
      )
      .bind(to, id, from, from, now)
      .run();
    return result.meta.changes > 0;
  }

  /** Removes stale previews so the table stays small. */
  async purgeExpired(now = Date.now()): Promise<void> {
    await this.db
      .prepare("DELETE FROM pending_events WHERE expires_at < ? AND status != 'approving'")
      .bind(now - PENDING_TTL_MS)
      .run();
  }

  async findEventByKey(guildId: string, dedupeKey: string): Promise<StoredEvent | null> {
    const row = await this.db
      .prepare("SELECT * FROM events WHERE guild_id = ? AND dedupe_key = ?")
      .bind(guildId, dedupeKey)
      .first<EventRow>();
    return row ? toEvent(row) : null;
  }

  /** Records a created Discord event. Returns false if this event was already recorded. */
  async recordEvent(event: Omit<StoredEvent, "createdAt">, now = Date.now()): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO events
          (id, guild_id, dedupe_key, title, start_time, approved_by, pending_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(event.id, event.guildId, event.dedupeKey, event.title, event.startTime, event.approvedBy, event.pendingId, now)
      .run();
    return result.meta.changes > 0;
  }
}
