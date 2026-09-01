import { json, body } from '../_lib/db.js';

export async function onRequest(context) {
  if (context.request.method === 'GET') {
    const { results } = await context.env.DB.prepare(`SELECT id,name,unit,stock_qty,low_threshold,active FROM ingredients ORDER BY name`).all();
    return json({ ingredients: results });
  }
  if (context.request.method !== 'PATCH') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET, PATCH' });
  const input = await body(context.request);
  if (!input.id || !Number.isFinite(Number(input.stock_qty)) || Number(input.stock_qty) < 0) return json({ error: 'Stock invalide' }, 400);
  const result = await context.env.DB.prepare(`UPDATE ingredients SET stock_qty=?, updated_at=? WHERE id=?`).bind(Number(input.stock_qty),new Date().toISOString(),input.id).run();
  if (!result.meta.changes) return json({ error: 'Ingrédient introuvable' }, 404);
  return json({ ok: true });
}
