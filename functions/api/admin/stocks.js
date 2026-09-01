import { json, body } from '../_lib/db.js';
export async function onRequest(context) {
  const db = context.env.DB;
  if (context.request.method === 'GET') {
    const { results } = await db.prepare(`SELECT id,name,unit,quantity,low_threshold FROM ingredients ORDER BY name`).all();
    return json({ ingredients: results.map(i => ({ ...i, low: Number(i.quantity) <= Number(i.low_threshold) })) });
  }
  if (context.request.method !== 'PATCH') return json({ error:'Méthode non autorisée' },405,{Allow:'GET, PATCH'});
  const input = await body(context.request); const qty=Number(input.quantity);
  if (!input.id || !Number.isFinite(qty) || qty < 0) return json({ error:'Stock invalide' },400);
  const old = await db.prepare(`SELECT quantity FROM ingredients WHERE id=?`).bind(input.id).first();
  if (!old) return json({ error:'Ingrédient introuvable' },404);
  const delta=qty-Number(old.quantity); const now=new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE ingredients SET quantity=? WHERE id=?`).bind(qty,input.id),
    db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,created_at) VALUES (?,?,?,?)`).bind(input.id,delta,input.reason ?? 'manual',now)
  ]);
  return json({ ok:true, quantity:qty });
}
