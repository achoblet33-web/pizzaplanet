PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS order_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_order_status_events_order
ON order_status_events(order_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_order_status_events_status
ON order_status_events(status, occurred_at);

INSERT INTO order_status_events (order_id,status,occurred_at,source)
SELECT o.id,o.status,o.updated_at,'migration'
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_status_events e WHERE e.order_id=o.id
);
