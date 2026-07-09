-- Focus push backend. Two tables, no user accounts — everything is
-- scoped by a random deviceId the client generates and keeps in
-- localStorage. Apply with: wrangler d1 execute focus-push-db --file=schema.sql

CREATE TABLE IF NOT EXISTS subscriptions (
  device_id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,  -- PushSubscription JSON, as given by the browser
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending (
  device_id TEXT NOT NULL,
  nid INTEGER NOT NULL,        -- matches the client's notification id scheme
  fire_at INTEGER NOT NULL,    -- epoch ms
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (device_id, nid)
);

CREATE INDEX IF NOT EXISTS idx_pending_fire_at ON pending(fire_at);

-- Rolling debug log (see GET /status). No titles/bodies — just delivery
-- outcomes, so push failures are visible instead of silently swallowed.
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- 'cron' | 'send' | 'error'
  detail TEXT NOT NULL
);
