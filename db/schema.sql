-- MaterialBot DB Schema

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Project threads we originate from (for location parsing & caching)
CREATE TABLE IF NOT EXISTS threads (
  thread_id            TEXT PRIMARY KEY,
  project_title        TEXT NOT NULL,
  location_text        TEXT,              -- raw City, ST parsed from title
  city                 TEXT,
  state                TEXT,
  lat                  REAL,
  lng                  REAL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- In-progress "cart" per requester per project-thread
CREATE TABLE IF NOT EXISTS carts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id            TEXT NOT NULL,
  requester_id         TEXT NOT NULL,
  need_by              DATETIME,          -- optional until confirm
  notes                TEXT,
  data_json            TEXT NOT NULL,     -- { items: [{desc, qty_value, qty_unit, notes}] }
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, requester_id)
);

-- Confirmed orders
CREATE TABLE IF NOT EXISTS orders (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id            TEXT NOT NULL,     -- FK to threads.thread_id (not enforced for cross-guild safety)
  requester_id         TEXT NOT NULL,
  need_by              DATETIME,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|filled|overdue|cancelled
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_thread ON orders(thread_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Items inside an order
CREATE TABLE IF NOT EXISTS order_items (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL,
  description          TEXT NOT NULL,
  quantity_value       REAL,              -- allow decimals (e.g., 2.5 CY)
  quantity_unit        TEXT,              -- e.g., pcs, CY, ft, gal
  notes                TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Forum post linkage (Material Discussions) & pinning
CREATE TABLE IF NOT EXISTS forum_posts (
  order_id             INTEGER PRIMARY KEY,
  forum_channel_id     TEXT NOT NULL,
  forum_thread_id      TEXT NOT NULL,
  project_thread_id    TEXT NOT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  pinned               INTEGER DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Message mirroring map (so replies/edits can be reflected both ways)
CREATE TABLE IF NOT EXISTS message_links (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER,
  source_channel_id    TEXT NOT NULL,
  source_message_id    TEXT NOT NULL,
  dest_channel_id      TEXT NOT NULL,
  dest_message_id      TEXT NOT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- Supplier cache (30-day TTL) for brand lookups near a city/state
CREATE TABLE IF NOT EXISTS supplier_cache (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source               TEXT NOT NULL,     -- google|osm
  place_id             TEXT,              -- Google place_id or OSM id string
  brand                TEXT,              -- e.g., "Sherwin-Williams", "Ready-Mix"
  type                 TEXT,              -- hardware|readymix|paint|chain|other
  name                 TEXT NOT NULL,
  address              TEXT,
  phone                TEXT,
  city                 TEXT,
  state                TEXT,
  lat                  REAL,
  lng                  REAL,
  distance_mi          REAL,
  cached_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at           DATETIME           -- set +30 days
);

CREATE INDEX IF NOT EXISTS idx_supplier_cache_brand_city_state ON supplier_cache(brand, city, state);
CREATE INDEX IF NOT EXISTS idx_supplier_cache_expires ON supplier_cache(expires_at);

-- Which suppliers we attached to an order (snapshot via cache rows)
CREATE TABLE IF NOT EXISTS order_suppliers (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL,
  supplier_cache_id    INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(supplier_cache_id) REFERENCES supplier_cache(id) ON DELETE CASCADE
);

-- Reminder scheduler for pings every N hours (10 for this bot)
CREATE TABLE IF NOT EXISTS reminders (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL,
  frequency_hours      INTEGER NOT NULL DEFAULT 10,
  next_run_at          DATETIME NOT NULL,
  last_run_at          DATETIME,
  active               INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminders_next ON reminders(active, next_run_at);

-- Update triggers
CREATE TRIGGER IF NOT EXISTS trg_threads_updated
AFTER UPDATE ON threads
BEGIN
  UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE thread_id = NEW.thread_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_carts_updated
AFTER UPDATE ON carts
BEGIN
  UPDATE carts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
