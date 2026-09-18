CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('idle', 'syncing', 'success', 'error')),
  task_id TEXT,
  message TEXT,
  started_at INTEGER,
  synced_at INTEGER
);
