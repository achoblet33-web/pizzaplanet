CREATE TRIGGER IF NOT EXISTS prevent_order_item_for_confirmed_outage
BEFORE INSERT ON order_items
WHEN EXISTS (
  SELECT 1
  FROM recipes r
  JOIN ingredients i ON i.id = r.ingredient_id
  WHERE r.product_id = NEW.product_id
    AND i.quantity <= 0
    AND i.out_of_stock_confirmed = 1
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_OUT_OF_STOCK_CONFIRMED');
END;
