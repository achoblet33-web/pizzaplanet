-- Options visibles sur la carte papier.
INSERT OR IGNORE INTO menu_settings (id,restaurant_id,setting_key,setting_value) VALUES
(1,1,'dough_options','["pâte fine","pâte épaisse"]'),
(2,1,'supplement_price_small_cents','150'),
(3,1,'supplement_price_medium_cents','200'),
(4,1,'supplement_price_large_cents','250'),
(5,1,'pork_free_ham_substitution','jambon de dinde');
