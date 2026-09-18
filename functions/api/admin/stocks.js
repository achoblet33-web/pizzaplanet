import { json, body } from '../_lib/db.js';

export async function onRequest(context) {
  const db = context.env.DB;
  if (context.request.method === 'GET') {
    const { results } = await db.prepare(`SELECT id,name,unit,quantity,low_threshold,out_of_stock_confirmed,out_of_stock_confirmed_at FROM ingredients ORDER BY name`).all();
    return json({ ingredients: results.map(i => ({
      ...i,
      out_of_stock_confirmed: Boolean(i.out_of_stock_confirmed),
      low: Number(i.quantity) <= Number(i.low_threshold),
      zero: Number(i.quantity) <= 0
    })) });
  }
  if (context.request.method !== 'PATCH') return json({ error:'Méthode non autorisée' },405,{Allow:'GET, PATCH'});

  const input = await body(context.request);
  if (!input.id) return json({ error:'Ingrédient requis' },400);
  const ingredient = await db.prepare(`SELECT id,quantity,out_of_stock_confirmed FROM ingredients WHERE id=?`).bind(input.id).first();
  if (!ingredient) return json({ error:'Ingrédient introuvable' },404);
  const now = new Date().toISOString();

  if (input.action === 'confirm_out') {
    if (Number(ingredient.quantity) > 0) return json({ error:'Impossible de confirmer une rupture tant que le stock est supérieur à zéro.' },409);
    await db.prepare(`UPDATE ingredients SET out_of_stock_confirmed=1,out_of_stock_confirmed_at=?,updated_at=? WHERE id=?`).bind(now,now,input.id).run();
    await db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,created_at) VALUES (?,?,?,?)`).bind(input.id,0,'out_of_stock_confirmed',now).run();
    return json({ ok:true,out_of_stock_confirmed:true });
  }

  if (input.action === 'unconfirm_out') {
    await db.prepare(`UPDATE ingredients SET out_of_stock_confirmed=0,out_of_stock_confirmed_at=NULL,updated_at=? WHERE id=?`).bind(now,input.id).run();
    await db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,created_at) VALUES (?,?,?,?)`).bind(input.id,0,'out_of_stock_unconfirmed',now).run();
    return json({ ok:true,out_of_stock_confirmed:false });
  }

  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty < 0) return json({ error:'Stock invalide' },400);
  const delta = qty - Number(ingredient.quantity);
  // A replenishment automatically clears an old rupture confirmation.
  const confirmed = qty <= 0 ? Boolean(ingredient.out_of_stock_confirmed) : false;
  await db.batch([
    db.prepare(`UPDATE ingredients SET quantity=?,out_of_stock_confirmed=?,out_of_stock_confirmed_at=?,updated_at=? WHERE id=?`).bind(qty,confirmed?1:0,confirmed?(ingredient.out_of_stock_confirmed_at||now):null,now,input.id),
    db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,created_at) VALUES (?,?,?,?)`).bind(input.id,delta,input.reason ?? 'manual',now)
  ]);
  return json({ ok:true,quantity:qty,out_of_stock_confirmed:confirmed });
}
