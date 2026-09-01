import { json, body } from './_lib/db.js';
function makeId() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); }
export async function onRequest(context) {
  const db = context.env.DB;
  if (context.request.method === 'GET') {
    const { results } = await db.prepare('SELECT id,status,payment_status,total_cents,fulfillment_type,customer_name,created_at FROM orders ORDER BY created_at DESC LIMIT 100').all();
    return json({ orders: results });
  }
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, POST' });
  const input = await body(context.request);
  if (!Array.isArray(input.items) || !input.items.length) return json({ error: 'Panier vide' }, 400);
  if (!input.customer?.name) return json({ error: 'Nom client requis' }, 400);
  const sizeIds = [...new Set(input.items.map(i => Number(i.product_size_id)))];
  if (sizeIds.some(id => !Number.isInteger(id) || id < 1)) return json({ error: 'Taille invalide' }, 400);
  const placeholders = sizeIds.map(() => '?').join(',');
  const { results: variants } = await db.prepare(`SELECT ps.id size_id, ps.product_id, ps.label size_label, ps.price_cents, p.name, p.active product_active, p.available FROM product_sizes ps JOIN products p ON p.id=ps.product_id WHERE ps.id IN (${placeholders}) AND ps.active=1`).bind(...sizeIds).all();
  const bySize = new Map(variants.map(v => [Number(v.size_id), v]));
  let total = 0;
  const normalized = [];
  for (const item of input.items) {
    const v = bySize.get(Number(item.product_size_id));
    const qty = Number(item.quantity);
    if (!v || !v.product_active || !v.available || !Number.isInteger(qty) || qty < 1 || qty > 20) return json({ error: `Produit indisponible: ${v?.name ?? item.product_size_id}` }, 409);
    total += v.price_cents * qty;
    normalized.push({ ...v, quantity: qty, options: item.options ?? {} });
  }
  const restaurant = await db.prepare('SELECT id FROM restaurants ORDER BY id LIMIT 1').first();
  if (!restaurant) return json({ error: 'Restaurant non configuré' }, 500);
  const orderId = makeId();
  const now = new Date().toISOString();
  const statements = [db.prepare('INSERT INTO orders (id,restaurant_id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(orderId,restaurant.id,input.customer.name,input.customer.phone ?? null,input.customer.email ?? null,input.fulfillment_type ?? 'pickup',total,'new','pending',input.notes ?? null,now,now)];
  for (const i of normalized) statements.push(db.prepare('INSERT INTO order_items (order_id,product_id,product_size_id,product_name,size_label,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?,?,?)').bind(orderId,i.product_id,i.size_id,i.name,i.size_label,i.quantity,i.price_cents,JSON.stringify(i.options)));
  await db.batch(statements);
  return json({ order: { id: orderId, total_cents: total, status: 'new', payment_status: 'pending' } }, 201);
}
