import { json, body, listProducts } from './_lib/db.js';

function makeId() { return crypto.randomUUID(); }

export async function onRequest(context) {
  if (context.request.method === 'GET') {
    const { results } = await context.env.DB.prepare(`SELECT id, status, total_cents, order_type, customer_name, created_at FROM orders ORDER BY created_at DESC LIMIT 100`).all();
    return json({ orders: results });
  }
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, POST' });

  const input = await body(context.request);
  if (!Array.isArray(input.items) || !input.items.length) return json({ error: 'Panier vide' }, 400);
  if (!input.customer?.name) return json({ error: 'Nom client requis' }, 400);

  const ids = [...new Set(input.items.map(i => String(i.product_id)))];
  const placeholders = ids.map(() => '?').join(',');
  const { results: products } = await context.env.DB.prepare(`SELECT id,name,price_cents,active,available FROM products WHERE id IN (${placeholders})`).bind(...ids).all();
  const byId = new Map(products.map(p => [String(p.id), p]));

  let total = 0;
  const normalized = [];
  for (const item of input.items) {
    const p = byId.get(String(item.product_id));
    const qty = Number(item.quantity);
    if (!p || !p.active || !p.available || !Number.isInteger(qty) || qty < 1 || qty > 20) return json({ error: `Produit indisponible: ${p?.name ?? item.product_id}` }, 409);
    total += p.price_cents * qty;
    normalized.push({ product_id: p.id, name: p.name, quantity: qty, unit_price_cents: p.price_cents, options: item.options ?? {} });
  }

  const orderId = makeId();
  const now = new Date().toISOString();
  const stmts = [context.env.DB.prepare(`INSERT INTO orders (id,customer_name,customer_phone,customer_email,order_type,notes,total_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(orderId,input.customer.name,input.customer.phone ?? null,input.customer.email ?? null,input.order_type ?? 'pickup',input.notes ?? null,total,'pending',now,now)];
  for (const i of normalized) stmts.push(context.env.DB.prepare(`INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?)`).bind(orderId,i.product_id,i.name,i.quantity,i.unit_price_cents,JSON.stringify(i.options)));
  await context.env.DB.batch(stmts);
  return json({ order: { id: orderId, total_cents: total, status: 'pending' } }, 201);
}
