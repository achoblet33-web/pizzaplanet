import { json, body } from './_lib/db.js';
function makeId() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); }
export async function onRequest(context) {
  const db = context.env.DB;
  if (context.request.method === 'GET') {
    const { results } = await db.prepare(`SELECT id,status,payment_status,total_cents,fulfillment_type,customer_name,created_at FROM orders ORDER BY created_at DESC LIMIT 100`).all();
    return json({ orders: results });
  }
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, POST' });
  const input = await body(context.request);
  if (!Array.isArray(input.items) || !input.items.length) return json({ error: 'Panier vide' }, 400);
  if (!input.customer?.name) return json({ error: 'Nom client requis' }, 400);
  const ids = [...new Set(input.items.map(i => Number(i.product_id)))];
  const placeholders = ids.map(() => '?').join(',');
  const { results: products } = await db.prepare(`SELECT id,name,price_cents,active,available FROM products WHERE id IN (${placeholders})`).bind(...ids).all();
  const byId = new Map(products.map(p => [Number(p.id), p]));
  let total = 0; const normalized = [];
  for (const item of input.items) {
    const p = byId.get(Number(item.product_id)); const qty = Number(item.quantity);
    if (!p || !p.active || !p.available || !Number.isInteger(qty) || qty < 1 || qty > 20) return json({ error: `Produit indisponible: ${p?.name ?? item.product_id}` }, 409);
    total += p.price_cents * qty; normalized.push({ ...p, quantity: qty, options: item.options ?? {} });
  }
  const restaurant = await db.prepare(`SELECT id FROM restaurants ORDER BY id LIMIT 1`).first();
  if (!restaurant) return json({ error: 'Restaurant non configuré' }, 500);
  const orderId = makeId(); const now = new Date().toISOString();
  const stmts = [db.prepare(`INSERT INTO orders (id,restaurant_id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderId,restaurant.id,input.customer.name,input.customer.phone ?? null,input.customer.email ?? null,input.fulfillment_type ?? 'pickup',total,'new','pending',input.notes ?? null,now,now)];
  for (const i of normalized) stmts.push(db.prepare(`INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?)`).bind(orderId,i.id,i.name,i.quantity,i.price_cents,JSON.stringify(i.options)));
  await db.batch(stmts); return json({ order: { id: orderId,total_cents: total,status:'new',payment_status:'pending' } },201);
}
