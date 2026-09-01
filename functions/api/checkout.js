import { json, body } from './_lib/db.js';

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

function stripeHeaders(secret) {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' };
}

function add(params, key, value) { params.append(key, String(value)); }

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'POST' });
  if (!context.env.STRIPE_SECRET_KEY) return json({ error: 'Stripe non configuré côté serveur' }, 503);
  const input = await body(context.request);
  if (!Array.isArray(input.items) || !input.items.length) return json({ error: 'Panier vide' }, 400);
  if (!input.customer?.name) return json({ error: 'Nom client requis' }, 400);

  const ids = [...new Set(input.items.map(i => Number(i.product_id)))];
  const placeholders = ids.map(() => '?').join(',');
  const { results: products } = await context.env.DB.prepare(`SELECT id,name,price_cents,active,available FROM products WHERE id IN (${placeholders})`).bind(...ids).all();
  const byId = new Map(products.map(p => [Number(p.id), p]));
  const normalized = [];
  let total = 0;

  for (const item of input.items) {
    const product = byId.get(Number(item.product_id));
    const quantity = Number(item.quantity);
    if (!product || !product.active || !product.available || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return json({ error: `Produit indisponible: ${product?.name ?? item.product_id}` }, 409);
    }
    total += product.price_cents * quantity;
    normalized.push({ product, quantity });
  }

  const restaurant = await context.env.DB.prepare(`SELECT id,currency FROM restaurants ORDER BY id LIMIT 1`).first();
  if (!restaurant) return json({ error: 'Restaurant non configuré' }, 500);

  const orderId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const now = new Date().toISOString();
  const order = await context.env.DB.prepare(`INSERT INTO orders (id,restaurant_id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    orderId, restaurant.id, input.customer.name, input.customer.phone ?? null, input.customer.email ?? null,
    input.fulfillment_type ?? 'pickup', total, 'new', 'pending', input.notes ?? null, now, now
  ).run();
  if (!order.meta.changes) return json({ error: 'Impossible de créer la commande' }, 500);

  const orderStatements = normalized.map(({ product, quantity }) => context.env.DB.prepare(`INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?)`).bind(
    orderId, product.id, product.name, quantity, product.price_cents, JSON.stringify({})
  ));
  await context.env.DB.batch(orderStatements);

  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams();
  add(params, 'mode', 'payment');
  add(params, 'success_url', `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`);
  add(params, 'cancel_url', `${origin}/payment-cancel.html?order_id=${orderId}`);
  add(params, 'client_reference_id', orderId);
  if (input.customer.email) add(params, 'customer_email', input.customer.email);
  add(params, 'metadata[order_id]', orderId);
  add(params, 'payment_intent_data[metadata][order_id]', orderId);

  normalized.forEach(({ product, quantity }, index) => {
    add(params, `line_items[${index}][quantity]`, quantity);
    add(params, `line_items[${index}][price_data][currency]`, restaurant.currency || 'eur');
    add(params, `line_items[${index}][price_data][unit_amount]`, product.price_cents);
    add(params, `line_items[${index}][price_data][product_data][name]`, product.name);
  });

  const response = await fetch(STRIPE_API, { method: 'POST', headers: stripeHeaders(context.env.STRIPE_SECRET_KEY), body: params });
  const session = await response.json();
  if (!response.ok || !session.id || !session.url) {
    await context.env.DB.prepare(`UPDATE orders SET status='cancelled',payment_status='failed',updated_at=? WHERE id=?`).bind(new Date().toISOString(), orderId).run();
    return json({ error: 'Impossible de créer la session de paiement', details: session?.error?.message }, 502);
  }

  await context.env.DB.prepare(`UPDATE orders SET payment_status='pending',updated_at=? WHERE id=?`).bind(new Date().toISOString(), orderId).run();
  return json({ checkout_url: session.url, order_id: orderId });
}
