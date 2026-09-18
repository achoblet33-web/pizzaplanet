PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS dough_stock (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 restaurant_id INTEGER NOT NULL DEFAULT 1,
 dough_type TEXT NOT NULL CHECK(dough_type IN ('fine','epaisse')),
 size_code TEXT NOT NULL CHECK(size_code IN ('petite','moyenne','grande')),
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
 low_threshold INTEGER NOT NULL DEFAULT 5,
 configured INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(restaurant_id,dough_type,size_code)
);
CREATE TABLE IF NOT EXISTS print_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL UNIQUE,
 printer_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sent_at TEXT,
 printed_at TEXT,
 last_error TEXT
);
INSERT OR IGNORE INTO dough_stock(restaurant_id,dough_type,size_code) VALUES
(1,'fine','petite'),(1,'fine','moyenne'),(1,'fine','grande'),
(1,'epaisse','petite'),(1,'epaisse','moyenne'),(1,'epaisse','grande');
