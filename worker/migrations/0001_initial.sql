CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings TEXT NOT NULL,
  kiosk_rev TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  request_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  thumb_bytes INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','ready','deleting')),
  UNIQUE(event_id, request_id)
);

CREATE INDEX gallery_order ON photos(event_id, state, created_at DESC, id DESC);
CREATE INDEX event_expiry ON photos(event_id, state, expires_at);
CREATE INDEX cleanup_ready ON photos(expires_at) WHERE state = 'ready';
CREATE INDEX cleanup_lease ON photos(lease_until) WHERE state IN ('pending','deleting');

CREATE TABLE storage_usage (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL);
INSERT INTO storage_usage VALUES (1, 0);

CREATE TABLE daily_uploads (day INTEGER PRIMARY KEY, attempts INTEGER NOT NULL);

CREATE TRIGGER photo_reserved AFTER INSERT ON photos BEGIN
  UPDATE storage_usage SET bytes = bytes + NEW.bytes + NEW.thumb_bytes WHERE id = 1;
  UPDATE events SET reserved = reserved + 1 WHERE id = NEW.event_id;
  INSERT INTO daily_uploads VALUES (NEW.created_at / 86400000, 1)
    ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1;
END;

CREATE TRIGGER photo_changed AFTER UPDATE OF state ON photos
WHEN (OLD.state = 'ready') <> (NEW.state = 'ready') BEGIN
  UPDATE events SET revision = revision + 1 WHERE id = NEW.event_id;
END;

CREATE TRIGGER photo_released AFTER DELETE ON photos BEGIN
  UPDATE storage_usage SET bytes = bytes - OLD.bytes - OLD.thumb_bytes WHERE id = 1;
  UPDATE events SET reserved = reserved - 1, revision = revision + (OLD.state = 'ready')
    WHERE id = OLD.event_id;
END;
