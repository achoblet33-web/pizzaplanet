import { json } from './_lib/db.js';
import { activeCutoffId, publicOrderCode, estimateOrder, hasStatusEventTable } from './_lib/tracking.js';

const PUBLIC_STATUSES = new Set(['confirmed','preparing','ready','completed','cancelled']);

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET' });
  const code = cleanCode(new URL(context.request.url).searchParams.get('code'));
  if (code.length !== 4) return json({ error: 'Code de commande invalide' }, 400);

  const cutoff = activeCutoffId();
  const { results } = await context.env.DB.prepare(`
    SELECT id,status,payment_status,created_at,updated_at
    FROM orders
    WHERE id>=? AND payment_status='paid'
    ORDER BY id DESC
    LIMIT 300
  `).bind(cutoff).all();

  const order = results.find(row => publicOrderCode(row.id) === code);
  if (!order || !PUBLIC_STATUSES.has(order.status)) return json({ error: 'Commande introuvable ou hors suivi actif' }, 404);

  let events = [];
  if (await hasStatusEventTable(context.env.DB)) {
    const data = await context.env.DB.prepare(`
      SELECT status,occurred_at
      FROM order_status_events
      WHERE order_id=? AND status IN ('confirmed','preparing','ready','completed','cancelled')
      ORDER BY occurred_at,id
    `).bind(order.id).all();
    const seen = new Set();
    events = (data.results || []).filter(e => {
      if (seen.has(e.status)) return false;
      seen.add(e.status);
      return true;
    });
  }

  if (!events.length) {
    events = [
      { status: 'confirmed', occurred_at: order.created_at },
      ...(order.status !== 'confirmed' ? [{ status: order.status, occurred_at: order.updated_at }] : [])
    ];
  }

  const eta = await estimateOrder(context.env.DB, order);
  return json({
    code,
    status: order.status,
    fulfillment_type: 'pickup',
    created_at: order.created_at,
    updated_at: order.updated_at,
    timeline: events,
    ...eta,
    refreshed_at: new Date().toISOString()
  });
}
