ALTER TABLE ingredients ADD COLUMN out_of_stock_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN out_of_stock_confirmed_at TEXT;

UPDATE ingredients
SET out_of_stock_confirmed = 0,
    out_of_stock_confirmed_at = NULL
WHERE quantity > 0;
