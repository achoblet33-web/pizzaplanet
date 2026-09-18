export const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ORDER_CODE_LENGTH = 4;
export const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function publicOrderCode(id) {
  let n = BigInt(String(id)) % BigInt(ORDER_CODE_ALPHABET.length ** ORDER_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < ORDER_CODE_LENGTH; i++) {
    out = ORDER_CODE_ALPHABET[Number(n % BigInt(ORDER_CODE_ALPHABET.length))] + out;
    n /= BigInt(ORDER_CODE_ALPHABET.length);
  }
  return out;
}

export function activeCutoffId(now = Date.now()) {
  return (now - ACTIVE_WINDOW_MS) * 1000;
}

export async function hasStatusEventTable(db) {
  const row = await db.prepare(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='order_status_events'`).first();
  return Boolean(row?.ok);
}

export async function recordStatusEvent(db, orderId, status, occurredAt = new Date().toISOString(), source = 'system') {
  if (!(await hasStatusEventTable(db))) return false;
  await db.prepare(`INSERT INTO order_status_events (order_id,status,occurred_at,source) VALUES (?,?,?,?)`)
    .bind(orderId, status, occurredAt, source).run();
  return true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export async function averagePreparationMinutes(db) {
  if (!(await hasStatusEventTable(db))) return 20;
  const { results } = await db.prepare(`
    SELECT order_id,status,occurred_at
    FROM order_status_events
    WHERE status IN ('preparing','ready') AND occurred_at >= datetime('now','-30 days')
    ORDER BY order_id, occurred_at
  `).all();

  const pairs = new Map();
  for (const row of results) {
    const key = String(row.order_id);
    if (!pairs.has(key)) pairs.set(key, {});
    const item = pairs.get(key);
    if (row.status === 'preparing' && !item.preparing) item.preparing = Date.parse(row.occurred_at);
    if (row.status === 'ready' && !item.ready) item.ready = Date.parse(row.occurred_at);
  }

  const durations = [...pairs.values()]
    .filter(x => Number.isFinite(x.preparing) && Number.isFinite(x.ready) && x.ready > x.preparing)
    .map(x => (x.ready - x.preparing) / 60000)
    .filter(x => x >= 3 && x <= 120)
    .slice(-40);

  if (durations.length < 3) return 20;
  const avg = durations.reduce((sum, n) => sum + n, 0) / durations.length;
  return clamp(Math.round(avg), 8, 60);
}

export async function serviceEstimate(db) {
  const cutoff = activeCutoffId();
  const { results } = await db.prepare(`
    SELECT id,status,created_at,updated_at
    FROM orders
    WHERE id>=? AND payment_status='paid' AND status IN ('confirmed','preparing')
    ORDER BY id
  `).bind(cutoff).all();

  const average = await averagePreparationMinutes(db);
  const waiting = results.filter(o => o.status === 'confirmed').length;
  const preparing = results.filter(o => o.status === 'preparing').length;
  const estimate = clamp(Math.round(average + Math.max(0, waiting - 1) * 5 + preparing * 3), 10, 90);
  return {
    average_prep_minutes: average,
    waiting_orders: waiting,
    preparing_orders: preparing,
    active_orders: results.length,
    estimated_wait_minutes: estimate,
    estimated_wait_min: clamp(estimate - 5, 5, 90),
    estimated_wait_max: clamp(estimate + 5, 10, 95)
  };
}

export async function estimateOrder(db, order) {
  const average = await averagePreparationMinutes(db);
  if (order.status === 'ready' || order.status === 'completed') {
    return { estimated_minutes_remaining: 0, estimated_ready_at: order.updated_at };
  }
  if (order.status === 'cancelled') return { estimated_minutes_remaining: null, estimated_ready_at: null };

  let statusSince = Date.parse(order.updated_at || order.created_at);
  if (await hasStatusEventTable(db)) {
    const event = await db.prepare(`SELECT occurred_at FROM order_status_events WHERE order_id=? AND status=? ORDER BY id DESC LIMIT 1`)
      .bind(order.id, order.status).first();
    const parsed = Date.parse(event?.occurred_at || '');
    if (Number.isFinite(parsed)) statusSince = parsed;
  }

  let remaining = average;
  if (order.status === 'confirmed') {
    const cutoff = activeCutoffId();
    const ahead = await db.prepare(`
      SELECT COUNT(*) n FROM orders
      WHERE id>=? AND id<? AND payment_status='paid' AND status IN ('confirmed','preparing')
    `).bind(cutoff, order.id).first();
    remaining = clamp(average + Number(ahead?.n || 0) * 5, 5, 90);
  } else if (order.status === 'preparing') {
    const elapsed = Math.max(0, (Date.now() - statusSince) / 60000);
    remaining = clamp(Math.ceil(average - elapsed), 3, 60);
  }

  return {
    estimated_minutes_remaining: remaining,
    estimated_ready_at: new Date(Date.now() + remaining * 60000).toISOString()
  };
}
