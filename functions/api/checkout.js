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

  const productIds = [...new Set(input.items.map(i => Number(i.product_id)))];
  const variantIds = [...new Set(input.items.map(i => Number(i.variant_id)).filter(Number.isFinite))];
  const productPlaceholders = productIds.map(() => '?').join(',');
  const { results: products } = await context.env.DB.prepare(`SELECT id,name,price_cents,active,available FROM products WHERE id IN (${productPlaceholders})`).bind(...productIds).all();
  const byProductId = new Map(products.map(p => [Number(p.id), p]));

  let variants = [];
  if (variantIds.length) {
    const variantPlaceholders = variantIds.map(() => '?').join(',');
    ({ results: variants } = await context.env.DB.prepare(`SELECT id,product_id,size_code,label,price_cents,active FROM product_variants WHERE id IN (${variantPlaceholders})`).bind(...variantIds).all());
  }
  const byVariantId = new Map(variants.map(v => [Number(v.id), v]));

  const normalized = [];
  let total = 0;

  for (const item of input.items) {
    const product = byProductId.get(Number(item.product_id));
    const quantity = Number(item.quantity);
    if (!product || !product.active || !product.available || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return json({ error: `Produit indisponible: ${product?.name ?? item.product_id}` }, 409);
    }

    const activeVariants = await context.env.DB.prepare(`SELECT COUNT(*) count FROM product_variants WHERE product_id=? AND active=1`).bind(product.id).first();
    let variant = null;
    if (Number(activeVariants?.count || 0) > 0) {
      variant = byVariantId.get(Number(item.variant_id));
      if (!variant || Number(variant.product_id) !== Number(product.id) || !variant.active) {
        return json({ error: `Taille invalide pour ${product.name}` }, 409);
      }
    }

    const unitPrice = Number(variant?.price_cents ?? product.price_cents);
    total += unitPrice * quantity;
    normalized.push({ product, variant, quantity, unitPrice });
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

  const orderStatements = normalized.map(({ product, variant, quantity, unitPrice }) => context.env.DB.prepare(`INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?)`).bind(
    orderId, product.id, product.name, quantity, unitPrice, JSON.stringify(variant ? { variant_id: variant.id, size_code: variant.size_code, size_label: variant.label } : {})
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

  normalized.forEach(({ product, variant, quantity, unitPrice }, index) => {
    add(params, `line_items[${index}][quantity]`, quantity);
    add(params, `line_items[${index}][price_data][currency]`, restaurant.currency || 'eur');
    add(params, `line_items[${index}][price_data][unit_amount]`, unitPrice);
    add(params, `line_items[${index}][price_data][product_data][name]`, variant ? `${product.name} — ${variant.label}` : product.name);
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
