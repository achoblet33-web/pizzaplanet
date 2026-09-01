INSERT OR IGNORE INTO restaurants (id,name,timezone,currency,ordering_enabled) VALUES (1,'Planet Pizza','America/Martinique','EUR',1);
INSERT OR IGNORE INTO categories (id,restaurant_id,name,sort_order) VALUES (1,1,'Pizzas',1),(2,1,'Boissons',2);
INSERT OR IGNORE INTO products (id,restaurant_id,category_id,name,description,price_cents,active,available,sort_order) VALUES
(1,1,1,'Margherita','Tomate, mozzarella, basilic',1200,1,1,1),
(2,1,1,'Reine','Tomate, mozzarella, jambon, champignons',1450,1,1,2),
(3,1,1,'4 Fromages','Tomate, mozzarella, emmental, chèvre',1550,1,1,3),
(4,1,2,'Boisson','Boisson fraîche',250,1,1,1);
INSERT OR IGNORE INTO ingredients (id,restaurant_id,name,unit,quantity,low_threshold) VALUES
(1,1,'Tomate','g',10000,2000),(2,1,'Mozzarella','g',5000,1000),(3,1,'Jambon','g',3000,500),(4,1,'Champignons','g',2000,300),(5,1,'Emmental','g',2000,300),(6,1,'Chèvre','g',1500,250);
INSERT OR IGNORE INTO recipes (product_id,ingredient_id,quantity) VALUES
(1,1,100),(1,2,120),(2,1,100),(2,2,120),(2,3,80),(2,4,50),(3,1,100),(3,2,100),(3,5,50),(3,6,40);
