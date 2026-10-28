-- Event previews awaiting moderator approval.
CREATE TABLE pending_events (
  id              TEXT PRIMARY KEY,            -- random UUID, embedded in button custom_ids
  guild_id        TEXT NOT NULL,
  channel_id      TEXT,
  requested_by    TEXT NOT NULL,               -- Discord user ID
  source_url      TEXT NOT NULL,
  url_hash        TEXT NOT NULL,               -- SHA-256 of the normalized URL
  title           TEXT NOT NULL,
  description     TEXT,
  start_time      TEXT NOT NULL,               -- ISO 8601 UTC
  end_time        TEXT NOT NULL,               -- ISO 8601 UTC
  location        TEXT NOT NULL,
  warnings        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approving', 'approved', 'cancelled')),
  created_at      INTEGER NOT NULL,            -- Unix ms
  expires_at      INTEGER NOT NULL             -- Unix ms
);

CREATE INDEX idx_pending_guild_hash ON pending_events (guild_id, url_hash, status);

-- Discord scheduled events Schedly has created; the unique index is the duplicate guard.
CREATE TABLE events (
  id                TEXT PRIMARY KEY,          -- Discord scheduled event ID
  guild_id          TEXT NOT NULL,
  url_hash          TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  title             TEXT NOT NULL,
  start_time        TEXT NOT NULL,
  approved_by       TEXT NOT NULL,
  pending_id        TEXT,
  created_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_events_guild_hash ON events (guild_id, url_hash);
