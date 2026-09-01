import { json, body } from '../_lib/db.js';

const ALLOWED = new Set(['pending','confirmed','preparing','ready','completed','cancelled']);

export async function onRequest(context) {
  if (context.request.method === 'GET') {
    const { results } = await context.env.DB.prepare(`SELECT id,customer_name,customer_phone,order_type,total_cents,status,notes,created_at,updated_at FROM orders ORDER BY created_at DESC LIMIT 100`).all();
    return json({ orders: results });
  }
  if (context.request.method !== 'PATCH') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, PATCH' });
  const input = await body(context.request);
  if (!input.id || !ALLOWED.has(input.status)) return json({ error: 'Commande ou statut invalide' }, 400);
  const result = await context.env.DB.prepare(`UPDATE orders SET status=?, updated_at=? WHERE id=?`).bind(input.status,new Date().toISOString(),input.id).run();
  if (!result.meta.changes) return json({ error: 'Commande introuvable' }, 404);
  return json({ ok: true });
}
