-- Switch /schedule from links to images.

-- Previews only live for 24 hours, so the old link-based table is replaced outright.
DROP TABLE IF EXISTS pending_events;

CREATE TABLE pending_events (
  id            TEXT PRIMARY KEY,              -- random UUID, embedded in component custom_ids
  guild_id      TEXT NOT NULL,
  channel_id    TEXT,
  requested_by  TEXT NOT NULL,                 -- Discord user ID
  image_hash    TEXT NOT NULL,                 -- SHA-256 of the uploaded image bytes
  draft         TEXT,                          -- JSON EventDraft being reviewed; NULL until one is picked
  candidates    TEXT NOT NULL DEFAULT '[]',    -- JSON EventDraft[] found in the image
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approving', 'approved', 'cancelled')),
  created_at    INTEGER NOT NULL,              -- Unix ms
  expires_at    INTEGER NOT NULL               -- Unix ms
);

CREATE INDEX idx_pending_guild_image ON pending_events (guild_id, image_hash, status);

-- Created events are kept; duplicates are now identified by title + start time instead of URL.
CREATE TABLE events_v2 (
  id           TEXT PRIMARY KEY,               -- Discord scheduled event ID
  guild_id     TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL,                  -- see src/events/dedupe.ts
  title        TEXT NOT NULL,
  start_time   TEXT NOT NULL,                  -- ISO 8601 UTC
  approved_by  TEXT NOT NULL,
  pending_id   TEXT,
  created_at   INTEGER NOT NULL
);

INSERT OR IGNORE INTO events_v2 (id, guild_id, dedupe_key, title, start_time, approved_by, pending_id, created_at)
  SELECT id, guild_id, lower(trim(title)) || '|' || start_time, title, start_time, approved_by, pending_id, created_at
  FROM events;

DROP TABLE events;
ALTER TABLE events_v2 RENAME TO events;

CREATE UNIQUE INDEX idx_events_guild_key ON events (guild_id, dedupe_key);
