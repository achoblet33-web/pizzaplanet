PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Martinique',
  currency TEXT NOT NULL DEFAULT 'EUR',
  ordering_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_code TEXT NOT NULL CHECK(size_code IN ('petite','moyenne','grande')),
  label TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id,size_code)
);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  low_threshold REAL NOT NULL DEFAULT 0,
  out_of_stock_confirmed INTEGER NOT NULL DEFAULT 0,
  out_of_stock_confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipes (
  product_id INTEGER NOT NULL REFERENCES products(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(product_id,ingredient_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN ('pickup','delivery')),
  status TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL,
  notes TEXT,
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  options_json TEXT
);
CREATE TABLE IF NOT EXISTS order_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity_delta REAL NOT NULL,
  reason TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_restaurant ON products(restaurant_id, active, available);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON orders(restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_ingredient ON inventory_movements(ingredient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id, active);
CREATE INDEX IF NOT EXISTS idx_order_status_events_order ON order_status_events(order_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_order_status_events_status ON order_status_events(status, occurred_at);

CREATE TRIGGER IF NOT EXISTS prevent_negative_stock
BEFORE UPDATE OF quantity ON ingredients
WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFFICIENT');
END;

CREATE TRIGGER IF NOT EXISTS prevent_order_item_for_confirmed_outage
BEFORE INSERT ON order_items
WHEN EXISTS (
  SELECT 1 FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id
  WHERE r.product_id=NEW.product_id AND i.quantity<=0 AND i.out_of_stock_confirmed=1
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_OUT_OF_STOCK_CONFIRMED');
END;
