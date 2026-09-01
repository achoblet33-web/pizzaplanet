import { json } from '../_lib/db.js';

const TOLERANCE_SECONDS = 300;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

async function verifyStripeSignature(request, secret, rawBody) {
  const header = request.headers.get('stripe-signature');
  if (!header) return false;
  const parts = header.split(',');
  const timestamp = Number(parts.find(x => x.startsWith('t='))?.slice(2));
  const signatures = parts.filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = await sign(secret, `${timestamp}.${rawBody}`);
  return signatures.some(value => constantTimeEqual(expected, hexToBytes(value)));
}

async function deductStock(db, orderId) {
  const order = await db.prepare(`SELECT id,stock_deducted,payment_status,status FROM orders WHERE id=?`).bind(orderId).first();
  if (!order) return { ok: false, error: 'Commande introuvable' };
  if (Number(order.stock_deducted) === 1) return { ok: true, changed: false };
  if (order.payment_status !== 'paid') return { ok: false, error: 'Paiement non confirmé' };

  const { results } = await db.prepare(`
    SELECT r.ingredient_id,i.name,i.unit,i.quantity stock_qty,SUM(r.quantity*oi.quantity) required_qty
    FROM order_items oi JOIN recipes r ON r.product_id=oi.product_id JOIN ingredients i ON i.id=r.ingredient_id
    WHERE oi.order_id=? GROUP BY r.ingredient_id,i.name,i.unit,i.quantity
  `).bind(orderId).all();

  const insufficient = results.filter(r => Number(r.stock_qty) < Number(r.required_qty));
  if (insufficient.length) return { ok: false, error: 'Stock insuffisant après paiement', insufficient };

  const now = new Date().toISOString();
  const statements = [];
  for (const r of results) {
    statements.push(db.prepare(`UPDATE ingredients SET quantity=quantity-?,updated_at=? WHERE id=? AND quantity>=?`).bind(Number(r.required_qty), now, r.ingredient_id, Number(r.required_qty)));
    statements.push(db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,order_id,created_at) VALUES (?,?,?,?,?)`).bind(r.ingredient_id, -Number(r.required_qty), 'stripe_payment_consumption', orderId, now));
  }
  statements.push(db.prepare(`UPDATE orders SET stock_deducted=1,status='confirmed',updated_at=? WHERE id=? AND stock_deducted=0`).bind(now, orderId));
  await db.batch(statements);
  return { ok: true, changed: true };
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'POST' });
  if (!context.env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook Stripe non configuré' }, 503);
  const rawBody = await context.request.text();
  if (!(await verifyStripeSignature(context.request, context.env.STRIPE_WEBHOOK_SECRET, rawBody))) return json({ error: 'Signature Stripe invalide' }, 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'Payload JSON invalide' }, 400); }

  const insert = await context.env.DB.prepare(`INSERT OR IGNORE INTO stripe_events (event_id,event_type,status) VALUES (?,?,?)`).bind(event.id,event.type,'received').run();
  if (!insert.meta.changes) return json({ received: true, duplicate: true });

  try {
    const session = event.data?.object;
    const orderId = session?.metadata?.order_id || session?.client_reference_id;
    if (orderId && (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded')) {
      const paymentPaid = session.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded';
      if (paymentPaid) {
        await context.env.DB.prepare(`UPDATE orders SET payment_status='paid',updated_at=? WHERE id=?`).bind(new Date().toISOString(), orderId).run();
        const stock = await deductStock(context.env.DB, orderId);
        if (!stock.ok) {
          await context.env.DB.prepare(`UPDATE stripe_events SET status='stock_error',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();
          return json({ received:true, warning:stock.error, insufficient:stock.insufficient ?? [] });
        }
      }
    } else if (orderId && event.type === 'checkout.session.async_payment_failed') {
      await context.env.DB.prepare(`UPDATE orders SET payment_status='failed',status='cancelled',updated_at=? WHERE id=?`).bind(new Date().toISOString(),orderId).run();
    }

    await context.env.DB.prepare(`UPDATE stripe_events SET status='processed',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();
    return json({ received: true });
  } catch (error) {
    await context.env.DB.prepare(`UPDATE stripe_events SET status='error',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();
    return json({ error: 'Erreur traitement webhook' }, 500);
  }
}
