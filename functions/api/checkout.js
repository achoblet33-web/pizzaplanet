import { json, body } from './_lib/db.js';

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

function stripeHeaders(secret) {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' };
}
function add(params, key, value) { params.append(key, String(value)); }
function orderNumber(id) { return `PP-${BigInt(String(id)).toString(36).toUpperCase()}`; }

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'POST' });
  if (!context.env.STRIPE_SECRET_KEY) return json({ error: 'Stripe non configuré côté serveur' }, 503);

  const input = await body(context.request);
  if (!Array.isArray(input.items) || !input.items.length) return json({ error: 'Panier vide' }, 400);
  if (input.items.length > 40) return json({ error: 'Panier trop volumineux' }, 400);
  if (!input.customer?.name?.trim()) return json({ error: 'Nom client requis' }, 400);

  const productIds = [...new Set(input.items.map(i => Number(i.product_id)).filter(Number.isFinite))];
  if (!productIds.length) return json({ error: 'Produits invalides' }, 400);
  const placeholders = productIds.map(() => '?').join(',');

  const { results: products } = await context.env.DB.prepare(
    `SELECT id,name,price_cents,active,available FROM products WHERE id IN (${placeholders})`
  ).bind(...productIds).all();
  const { results: variants } = await context.env.DB.prepare(
    `SELECT id,product_id,size_code,label,price_cents,active FROM product_variants WHERE product_id IN (${placeholders}) AND active=1`
  ).bind(...productIds).all();

  const byProductId = new Map(products.map(p => [Number(p.id), p]));
  const variantsByProduct = new Map();
  const byVariantId = new Map();
  for (const variant of variants) {
    byVariantId.set(Number(variant.id), variant);
    const productId = Number(variant.product_id);
    if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);
    variantsByProduct.get(productId).push(variant);
  }

  const normalized = [];
  for (const item of input.items) {
    const product = byProductId.get(Number(item.product_id));
    const quantity = Number(item.quantity);
    if (!product || !product.active || !product.available || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return json({ error: `Produit indisponible: ${product?.name ?? item.product_id}` }, 409);
    }

    const productVariants = variantsByProduct.get(Number(product.id)) || [];
    let variant = null;
    if (productVariants.length) {
      variant = byVariantId.get(Number(item.variant_id));
      if (!variant || Number(variant.product_id) !== Number(product.id) || !variant.active) {
        return json({ error: `Taille invalide pour ${product.name}` }, 409);
      }
    }

    normalized.push({
      product,
      variant,
      quantity,
      unitPrice: Number(variant?.price_cents ?? product.price_cents)
    });
  }

  // Offre 2 moyennes achetées = 1 moyenne offerte : le client met 3 moyennes
  // au panier et la moins chère de chaque groupe de 3 passe à 0 €.
  const mediumUnits = [];
  normalized.forEach((row, rowIndex) => {
    if (row.variant?.size_code === 'moyenne') {
      for (let n = 0; n < row.quantity; n++) mediumUnits.push({ rowIndex, price: row.unitPrice });
    }
  });
  const freePizzaCount = Math.floor(mediumUnits.length / 3);
  const cheapestMediums = [...mediumUnits].sort((a, b) => a.price - b.price);
  const freeByRow = new Map();
  for (let n = 0; n < freePizzaCount; n++) {
    const rowIndex = cheapestMediums[n].rowIndex;
    freeByRow.set(rowIndex, (freeByRow.get(rowIndex) || 0) + 1);
  }

  // Une boisson est offerte pour chaque pizza moyenne effectivement payée.
  const paidMediumCount = mediumUnits.length - freePizzaCount;
  const freeDrinks = paidMediumCount;
  const orderLines = [];
  let total = 0;
  let pizzaDiscount = 0;

  normalized.forEach((row, rowIndex) => {
    const freeQuantity = freeByRow.get(rowIndex) || 0;
    const paidQuantity = row.quantity - freeQuantity;
    const baseOptions = row.variant ? {
      variant_id: row.variant.id,
      size_code: row.variant.size_code,
      size_label: row.variant.label
    } : {};

    if (paidQuantity > 0) {
      orderLines.push({
        product: row.product,
        productName: row.product.name,
        quantity: paidQuantity,
        unitPrice: row.unitPrice,
        options: baseOptions,
        stripeName: row.variant ? `${row.product.name} — ${row.variant.label}` : row.product.name
      });
      total += row.unitPrice * paidQuantity;
    }

    if (freeQuantity > 0) {
      orderLines.push({
        product: row.product,
        productName: row.product.name,
        quantity: freeQuantity,
        unitPrice: 0,
        options: { ...baseOptions, promotion: '2_moyennes_1_offerte', promotion_label: 'Pizza moyenne offerte' },
        stripeName: `🎁 ${row.product.name} — ${row.variant?.label || 'Moyenne'} OFFERTE`
      });
      pizzaDiscount += row.unitPrice * freeQuantity;
    }
  });

  if (freeDrinks > 0) {
    orderLines.push({
      product: null,
      productName: 'Boisson offerte',
      quantity: freeDrinks,
      unitPrice: 0,
      options: { promotion: '1_moyenne_1_boisson', promotion_label: 'Boisson offerte', source_paid_mediums: paidMediumCount },
      stripeName: `🎁 Boisson offerte × ${freeDrinks}`
    });
  }

  const restaurant = await context.env.DB.prepare(`SELECT id,currency FROM restaurants ORDER BY id LIMIT 1`).first();
  if (!restaurant) return json({ error: 'Restaurant non configuré' }, 500);

  const orderId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const displayOrderNumber = orderNumber(orderId);
  const now = new Date().toISOString();
  const promoNote = [
    freeDrinks ? `${freeDrinks} boisson(s) offerte(s)` : '',
    freePizzaCount ? `${freePizzaCount} pizza(s) moyenne(s) offerte(s)` : ''
  ].filter(Boolean).join(' · ');

  const order = await context.env.DB.prepare(
    `INSERT INTO orders (id,restaurant_id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    orderId, restaurant.id, input.customer.name.trim(), input.customer.phone ?? null, input.customer.email ?? null,
    input.fulfillment_type ?? 'pickup', total, 'new', 'pending', [input.notes, promoNote].filter(Boolean).join(' | ') || null, now, now
  ).run();
  if (!order.meta.changes) return json({ error: 'Impossible de créer la commande' }, 500);

  const orderStatements = orderLines.map(line => context.env.DB.prepare(
    `INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES (?,?,?,?,?,?)`
  ).bind(
    orderId, line.product?.id ?? null, line.productName, line.quantity, line.unitPrice, JSON.stringify(line.options || {})
  ));
  await context.env.DB.batch(orderStatements);

  const origin = new URL(context.request.url).origin;
  const params = new URLSearchParams();
  add(params, 'mode', 'payment');
  add(params, 'success_url', `${origin}/payment-success.html?order_id=${orderId}&session_id={CHECKOUT_SESSION_ID}`);
  add(params, 'cancel_url', `${origin}/payment-cancel.html?order_id=${orderId}`);
  add(params, 'client_reference_id', orderId);
  if (input.customer.email) add(params, 'customer_email', input.customer.email);
  add(params, 'metadata[order_id]', orderId);
  add(params, 'metadata[order_number]', displayOrderNumber);
  add(params, 'metadata[free_drinks]', freeDrinks);
  add(params, 'metadata[free_medium_pizzas]', freePizzaCount);
  add(params, 'payment_intent_data[metadata][order_id]', orderId);
  add(params, 'payment_intent_data[metadata][order_number]', displayOrderNumber);

  orderLines.forEach((line, index) => {
    add(params, `line_items[${index}][quantity]`, line.quantity);
    add(params, `line_items[${index}][price_data][currency]`, restaurant.currency || 'eur');
    add(params, `line_items[${index}][price_data][unit_amount]`, line.unitPrice);
    add(params, `line_items[${index}][price_data][product_data][name]`, line.stripeName);
  });

  const response = await fetch(STRIPE_API, {
    method: 'POST', headers: stripeHeaders(context.env.STRIPE_SECRET_KEY), body: params
  });
  const session = await response.json();
  if (!response.ok || !session.id || !session.url) {
    await context.env.DB.prepare(`UPDATE orders SET status='cancelled',payment_status='failed',updated_at=? WHERE id=?`).bind(new Date().toISOString(), orderId).run();
    return json({ error: 'Impossible de créer la session de paiement', details: session?.error?.message }, 502);
  }

  return json({
    checkout_url: session.url,
    order_id: orderId,
    order_number: displayOrderNumber,
    total_cents: total,
    promotions: { free_drinks: freeDrinks, free_medium_pizzas: freePizzaCount, pizza_discount_cents: pizzaDiscount }
  });
}
