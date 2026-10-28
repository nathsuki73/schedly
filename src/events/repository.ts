// Typed access to D1. All SQL lives here; callers work with camelCase domain objects.

export type PendingStatus = "pending" | "approving" | "approved" | "cancelled";

export interface PendingEvent {
  id: string;
  guildId: string;
  channelId: string | null;
  requestedBy: string;
  sourceUrl: string;
  urlHash: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  location: string;
  warnings: string[];
  status: PendingStatus;
  createdAt: number;
  expiresAt: number;
}

export type NewPendingEvent = Omit<PendingEvent, "id" | "status" | "createdAt" | "expiresAt">;

export interface StoredEvent {
  id: string;
  guildId: string;
  urlHash: string;
  sourceUrl: string;
  title: string;
  startTime: string;
  approvedBy: string;
  pendingId: string | null;
  createdAt: number;
}

/** How long a preview can wait for approval. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingRow {
  id: string;
  guild_id: string;
  channel_id: string | null;
  requested_by: string;
  source_url: string;
  url_hash: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string;
  warnings: string;
  status: PendingStatus;
  created_at: number;
  expires_at: number;
}

interface EventRow {
  id: string;
  guild_id: string;
  url_hash: string;
  source_url: string;
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
    sourceUrl: row.source_url,
    urlHash: row.url_hash,
    title: row.title,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    warnings: JSON.parse(row.warnings) as string[],
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    guildId: row.guild_id,
    urlHash: row.url_hash,
    sourceUrl: row.source_url,
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
          (id, guild_id, channel_id, requested_by, source_url, url_hash, title, description,
           start_time, end_time, location, warnings, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        pending.id,
        pending.guildId,
        pending.channelId,
        pending.requestedBy,
        pending.sourceUrl,
        pending.urlHash,
        pending.title,
        pending.description,
        pending.startTime,
        pending.endTime,
        pending.location,
        JSON.stringify(pending.warnings),
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

  /** A preview for the same link that is still awaiting a decision, if any. */
  async findActivePending(guildId: string, urlHash: string, now = Date.now()): Promise<PendingEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM pending_events
         WHERE guild_id = ? AND url_hash = ? AND status IN ('pending', 'approving') AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(guildId, urlHash, now)
      .first<PendingRow>();
    return row ? toPending(row) : null;
  }

  /**
   * Atomically moves a preview from one status to another. Returns false if the preview
   * was not in `from` (e.g. someone else already handled it) — this is the double-click guard.
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

  async findEventByHash(guildId: string, urlHash: string): Promise<StoredEvent | null> {
    const row = await this.db
      .prepare("SELECT * FROM events WHERE guild_id = ? AND url_hash = ?")
      .bind(guildId, urlHash)
      .first<EventRow>();
    return row ? toEvent(row) : null;
  }

  /** An already-created event with the same title and start time (likely shared via a different link). */
  async findSimilarEvent(guildId: string, title: string, startTime: string): Promise<StoredEvent | null> {
    const row = await this.db
      .prepare("SELECT * FROM events WHERE guild_id = ? AND lower(title) = lower(?) AND start_time = ? LIMIT 1")
      .bind(guildId, title, startTime)
      .first<EventRow>();
    return row ? toEvent(row) : null;
  }

  /** Records a created Discord event. Returns false if one already exists for this link. */
  async recordEvent(event: Omit<StoredEvent, "createdAt">, now = Date.now()): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO events
          (id, guild_id, url_hash, source_url, title, start_time, approved_by, pending_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.guildId,
        event.urlHash,
        event.sourceUrl,
        event.title,
        event.startTime,
        event.approvedBy,
        event.pendingId,
        now,
      )
      .run();
    return result.meta.changes > 0;
  }
}
